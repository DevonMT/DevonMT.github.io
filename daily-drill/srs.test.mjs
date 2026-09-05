/**
 * Tests for the Daily Drill scheduler (SPEC.md §7).
 *
 *   node --test daily-drill/srs.test.mjs
 *
 * The module is pure, so every case here is deterministic: dates are passed in,
 * randomness is injected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_SIZE, NEW_SLOTS, FORGET_DAYS, RETURN_GAP, MIN_EASE, DEFAULT_EASE,
  toDay, addDays, daysBetween,
  qualityFromRatio, isLapse, ratioFromRubric, scoreStatic,
  schedule, applyAnswer, newScheduleRow,
  applyForgetting, applyReturnPath,
  pickQuestion, rememberSeen, planSession, daysActive, isFreeText, FREE_TEXT_PER_SESSION,
  deriveState, mergeAttempts, seededRandom,
} from '../daily-drill/app/js/srs.js';

// ---------------------------------------------------------------- days

test('day helpers work off UTC day strings', () => {
  assert.equal(toDay('2026-09-03T22:41:00Z'), '2026-09-03');
  assert.equal(toDay('2026-09-03'), '2026-09-03');
  assert.equal(addDays('2026-09-03', 6), '2026-09-09');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-09-03', '2026-09-09'), 6);
  assert.equal(daysBetween('2026-09-09', '2026-09-03'), -6);
});

// ---------------------------------------------------------------- rubric -> quality

test('rubric ratio maps to quality at every boundary', () => {
  // the thresholds themselves
  assert.equal(qualityFromRatio(0.8), 5);
  assert.equal(qualityFromRatio(0.6), 4);
  assert.equal(qualityFromRatio(0.4), 3);
  assert.equal(qualityFromRatio(0.2), 2);
  assert.equal(qualityFromRatio(0), 1);
  // just below each threshold
  assert.equal(qualityFromRatio(0.7999), 4);
  assert.equal(qualityFromRatio(0.5999), 3);
  assert.equal(qualityFromRatio(0.3999), 2);
  assert.equal(qualityFromRatio(0.1999), 1);
  assert.equal(qualityFromRatio(1), 5);
});

test('a lapse is any quality below 3', () => {
  assert.equal(isLapse(2), true);
  assert.equal(isLapse(3), false, '3 is the lowest passing grade');
  assert.equal(isLapse(5), false);
});

test('real rubric shapes land where the spec says', () => {
  assert.equal(qualityFromRatio(ratioFromRubric([true, true, true])), 5);      // 3/3
  assert.equal(qualityFromRatio(ratioFromRubric([true, true, false])), 4);     // 2/3 = 0.67
  // 1 of 3 is 0.33, below the 0.4 passing line - so a three-criterion rubric
  // has no "scraped a pass" grade: you meet two, or it comes back tomorrow
  assert.equal(ratioFromRubric([true, false, false]).toFixed(2), '0.33');
  assert.equal(qualityFromRatio(ratioFromRubric([true, false, false])), 2);
  assert.equal(isLapse(qualityFromRatio(ratioFromRubric([true, false, false]))), true);
  assert.equal(qualityFromRatio(ratioFromRubric([true, true, false, false])), 3); // 2/4 = 0.5
  assert.equal(ratioFromRubric([]), 0);
});

// ---------------------------------------------------------------- static grading

const q = (type, answer) => ({ type, answer });

test('scoreStatic: all-or-nothing types', () => {
  assert.equal(scoreStatic(q('mcq', { correct: 2 }), { choice: 2 }), 1);
  assert.equal(scoreStatic(q('mcq', { correct: 2 }), { choice: 0 }), 0);
  assert.equal(scoreStatic(q('spot_error', { bad_line: 3 }), { line: 3 }), 1);
  assert.equal(scoreStatic(q('spot_error', { bad_line: 3 }), { line: 2 }), 0);
  assert.equal(scoreStatic(q('ordering', { correct_order: [2, 0, 1] }), { order: [2, 0, 1] }), 1);
  assert.equal(scoreStatic(q('ordering', { correct_order: [2, 0, 1] }), { order: [0, 1, 2] }), 0);
});

test('scoreStatic: cloze and predict_output are generous about form', () => {
  const cloze = q('cloze', { blanks: [{ accept: ['HAVING', 'having clause'] }] });
  assert.equal(scoreStatic(cloze, { texts: ['  having  '] }), 1, 'trimmed and case-insensitive');
  assert.equal(scoreStatic(cloze, { texts: ['WHERE'] }), 0);

  const po = q('predict_output', { accept: ['3, 2', '3 and 2'] });
  assert.equal(scoreStatic(po, { text: '3 AND 2' }), 1);
  assert.equal(scoreStatic(po, { text: '5' }), 0);
});

test('scoreStatic: multi gives partial credit and penalises wrong picks', () => {
  const m = q('multi', { correct: [0, 3] });
  assert.equal(scoreStatic(m, { choices: [0, 3] }), 1);
  assert.equal(scoreStatic(m, { choices: [0] }), 0.5);
  assert.equal(scoreStatic(m, { choices: [0, 3, 1] }), 0.5, 'one wrong pick cancels one right one');
  assert.equal(scoreStatic(m, { choices: [1, 2] }), 0, 'never negative');
  assert.equal(scoreStatic(m, { choices: [] }), 0);
});

test('scoreStatic: matching is proportional', () => {
  const m = q('matching', { pairs: [[0, 2], [1, 0], [2, 1]] });
  assert.equal(scoreStatic(m, { pairs: [[0, 2], [1, 0], [2, 1]] }), 1);
  assert.equal(Number(scoreStatic(m, { pairs: [[0, 2], [1, 1], [2, 0]] }).toFixed(2)), 0.33);
});

test('scoreStatic: tf_why averages the verdict with the rubric (§7)', () => {
  const t = q('tf_why', { correct: true });
  assert.equal(scoreStatic(t, { verdict: true, met: [true, true, true] }), 1);
  assert.equal(scoreStatic(t, { verdict: true, met: [false, false, false] }), 0.5, 'right verdict, no reasoning');
  assert.equal(scoreStatic(t, { verdict: false, met: [true, true, true] }), 0.5, 'wrong verdict, good reasoning');
  assert.equal(scoreStatic(t, { verdict: false, met: [false, false, false] }), 0);
});

// ---------------------------------------------------------------- sm-2

test('first three successful reps follow 1, 6, then interval * ease', () => {
  let row = schedule(newScheduleRow(), 5, '2026-09-03T20:00:00Z');
  assert.equal(row.interval_days, 1);
  assert.equal(row.due, '2026-09-04');
  assert.equal(row.reps, 1);

  row = schedule(row, 5, '2026-09-04T20:00:00Z');
  assert.equal(row.interval_days, 6);
  assert.equal(row.due, '2026-09-10');

  const easeAfterTwo = row.ease;
  row = schedule(row, 5, '2026-09-10T20:00:00Z');
  assert.equal(row.interval_days, Math.round(6 * easeAfterTwo));
  assert.equal(row.due, addDays('2026-09-10', row.interval_days));
});

test('intervals count from when you answered, not from now (§7)', () => {
  // grading lands three days after the answer; the due date must ignore that
  const row = schedule({ ...newScheduleRow(), reps: 1, interval_days: 6, ease: 2.5 }, 5, '2026-09-03T23:00:00Z');
  assert.equal(row.due, '2026-09-09', 'due is answered_at + 6, regardless of grade time');
  assert.equal(row.last_answered_at, '2026-09-03T23:00:00Z');
});

test('a lapse resets reps and interval but keeps the lapse count', () => {
  const start = { ease: 2.5, interval_days: 30, reps: 5, lapses: 1 };
  const row = schedule(start, 1, '2026-09-03');
  assert.equal(row.reps, 0);
  assert.equal(row.interval_days, 1);
  assert.equal(row.lapses, 2);
  assert.equal(row.due, '2026-09-04');
});

test('ease floors at 1.8 no matter how many lapses (§7)', () => {
  let row = newScheduleRow();
  for (let i = 0; i < 40; i++) row = schedule(row, 1, '2026-09-03');
  assert.equal(row.ease, MIN_EASE, 'never drops below the floor');
  assert.ok(row.ease > 1.3, 'and never reaches classic SM-2 territory');
});

test('quality 5 nudges ease up, quality 3 nudges it down', () => {
  assert.ok(schedule(newScheduleRow(), 5, '2026-09-03').ease > DEFAULT_EASE);
  assert.ok(schedule(newScheduleRow(), 3, '2026-09-03').ease < DEFAULT_EASE);
  assert.equal(schedule(newScheduleRow(), 4, '2026-09-03').ease, DEFAULT_EASE, 'q4 is neutral');
});

test('schedule does not mutate the row it was given', () => {
  const before = newScheduleRow();
  const snapshot = { ...before };
  schedule(before, 5, '2026-09-03');
  assert.deepEqual(before, snapshot);
});

test('applyAnswer records the ratio it graded on', () => {
  const row = applyAnswer(newScheduleRow(), 2 / 3, '2026-09-03T22:00:00Z');
  assert.equal(row.interval_days, 1);
  assert.equal(row.last_score, 0.6667);
});

// ---------------------------------------------------------------- forgetting rule

test('forgetting rule drops only what is more than 60 days overdue', () => {
  const sched = {
    'a.exactly_60': { due: addDays('2026-09-03', -FORGET_DAYS) },
    'b.just_over': { due: addDays('2026-09-03', -(FORGET_DAYS + 1)) },
    'c.fresh': { due: '2026-09-01' },
  };
  const out = applyForgetting(sched, [], '2026-09-03');
  assert.deepEqual(out.dropped, ['b.just_over'], '60 days stays, 61 goes');
  assert.ok('a.exactly_60' in out.schedule);
  assert.ok(!('b.just_over' in out.schedule));
  assert.deepEqual(out.unscheduled, ['b.just_over']);
});

test('forgetting rule strips schedule history so the concept returns as new', () => {
  const sched = { 'x.y': { due: '2026-01-01', ease: 1.8, reps: 9, lapses: 7 } };
  const out = applyForgetting(sched, [], '2026-09-03');
  assert.equal(out.schedule['x.y'], undefined, 'no row survives, so no ease or lapse history');
  assert.ok(out.unscheduled.includes('x.y'));
});

// ---------------------------------------------------------------- return path

const tier1 = () => 1;

test('return path does nothing inside the gap', () => {
  const sched = { a: { due: '2026-08-01', lapses: 0 } };
  const out = applyReturnPath(sched, addDays('2026-09-03', -RETURN_GAP), '2026-09-03', tier1, () => 0);
  assert.deepEqual(out.redistributed, [], 'exactly RETURN_GAP days is not a return');
});

test('return path keeps four and silently pushes the rest into the next two weeks', () => {
  const sched = {};
  for (let i = 0; i < 10; i++) sched[`c${i}`] = { due: '2026-07-01', lapses: 0 };
  const out = applyReturnPath(sched, '2026-06-01', '2026-09-03', tier1, () => 0.5);

  assert.equal(out.redistributed.length, 10 - SESSION_SIZE);
  for (const id of out.redistributed) {
    const days = daysBetween('2026-09-03', out.schedule[id].due);
    assert.ok(days >= 1 && days <= RETURN_GAP, `${id} pushed to +${days} days`);
  }
  const kept = Object.keys(sched).filter(id => !out.redistributed.includes(id));
  assert.equal(kept.length, SESSION_SIZE);
  for (const id of kept) assert.equal(out.schedule[id].due, '2026-07-01', 'kept items are untouched');
});

test('return path keeps the highest-value overdue: most lapses, then lowest tier', () => {
  const sched = {
    hard: { due: '2026-07-01', lapses: 5 },
    easy: { due: '2026-07-01', lapses: 0 },
    mid: { due: '2026-07-01', lapses: 2 },
    other: { due: '2026-07-01', lapses: 0 },
    fifth: { due: '2026-07-01', lapses: 0 },
  };
  const tiers = { hard: 3, easy: 1, mid: 2, other: 2, fifth: 3 };
  const out = applyReturnPath(sched, '2026-06-01', '2026-09-03', id => tiers[id], () => 0);
  assert.ok(!out.redistributed.includes('hard'), 'most lapses is kept');
  assert.ok(!out.redistributed.includes('mid'));
  assert.ok(!out.redistributed.includes('easy'), 'tier 1 beats tier 3 on a lapse tie');
  assert.deepEqual(out.redistributed, ['fifth'], 'the tier-3 no-lapse item is the one pushed');
});

// ---------------------------------------------------------------- question rotation

const Q = (id, type) => ({ id, type, concept_id: 'c' });

test('a session mixes free-text with static reps (§5)', () => {
  // every concept carries both kinds, so the mix is fully under selection's control
  const mixed = Object.fromEntries(catalog.map(c => [c.id, [
    { id: `${c.id}_ex`, type: 'explain', concept_id: c.id },
    { id: `${c.id}_cr`, type: 'critique', concept_id: c.id },
    { id: `${c.id}_mcq`, type: 'mcq', concept_id: c.id },
    { id: `${c.id}_ord`, type: 'ordering', concept_id: c.id },
  ]]));
  const out = planSession({
    state: { schedule: {}, seen: {}, unscheduled: [], session_dates: [] },
    catalog, questionsByConcept: mixed, today: '2026-09-03', rng: () => 0,
  });
  const free = out.picks.filter(p => isFreeText(p.question.type)).length;
  assert.equal(out.picks.length, SESSION_SIZE);
  assert.equal(free, FREE_TEXT_PER_SESSION, 'two free-text reps');
  assert.equal(SESSION_SIZE - free, 2, 'and two static ones');
});

test('the mix is a preference, not a filter: a concept with only free-text still gets asked', () => {
  const freeOnly = Object.fromEntries(catalog.map(c => [c.id, [
    { id: `${c.id}_ex`, type: 'explain', concept_id: c.id },
  ]]));
  const out = planSession({
    state: { schedule: {}, seen: {}, unscheduled: [], session_dates: [] },
    catalog, questionsByConcept: freeOnly, today: '2026-09-03', rng: () => 0,
  });
  assert.equal(out.picks.length, SESSION_SIZE, 'nobody is skipped for lacking a static rep');
});

test('tf_why counts as a static rep, not a free-text one', () => {
  assert.equal(isFreeText('tf_why'), false);
  assert.equal(isFreeText('explain'), true);
});

test('pickQuestion honours the mix preference when it can', () => {
  const qs = [Q('a', 'explain'), Q('b', 'mcq')];
  assert.equal(pickQuestion(qs, [], 'free').id, 'a');
  assert.equal(pickQuestion(qs, [], 'static').id, 'b');
  assert.equal(pickQuestion([Q('a', 'explain')], [], 'static').id, 'a', 'falls back rather than returning nothing');
});

test('pickQuestion avoids what was seen and prefers an unseen type', () => {
  const questions = [Q('q1', 'explain'), Q('q2', 'explain'), Q('q3', 'mcq')];
  assert.equal(pickQuestion(questions, []).id, 'q1');
  // q1 seen -> explain is a recent type, so the mcq wins over the other explain
  assert.equal(pickQuestion(questions, ['q1']).id, 'q3');
});

test('pickQuestion cycles rather than returning nothing once all are seen', () => {
  const questions = [Q('q1', 'explain'), Q('q2', 'mcq')];
  assert.ok(pickQuestion(questions, ['q1', 'q2']));
  assert.equal(pickQuestion([], []), null);
  assert.equal(pickQuestion(undefined, []), null);
});

test('seen list is most-recent-first and capped', () => {
  let seen = {};
  for (const id of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) seen = rememberSeen(seen, 'c', id);
  assert.equal(seen.c.length, 5);
  assert.equal(seen.c[0], 'q6');
  assert.ok(!seen.c.includes('q1'), 'oldest fell off');
  seen = rememberSeen(seen, 'c', 'q3');
  assert.equal(seen.c[0], 'q3');
  assert.equal(seen.c.filter(x => x === 'q3').length, 1, 'no duplicates');
});


// ---------------------------------------------------------------- derived state

const attempt = (concept_id, at, { score = 1, q, counted = true, id } = {}) => ({
  id: id ?? `a_${concept_id}_${at}`,
  concept_id,
  question_id: q ?? `${concept_id}_q1`,
  score,
  created_at: at,
  counted_toward_srs: counted,
});

test('schedule is a pure fold over the attempt log', () => {
  const attempts = [
    attempt('a', '2026-09-01T20:00:00Z'),
    attempt('a', '2026-09-02T20:00:00Z', { id: 'a2', q: 'a_q2' }),
  ];
  const { schedule } = deriveState(attempts);
  assert.equal(schedule.a.reps, 2);
  assert.equal(schedule.a.interval_days, 6, 'second success gives the 6-day interval');
  assert.equal(schedule.a.due, '2026-09-08');
});

test('replay order is by answered time, not array order', () => {
  const later = attempt('a', '2026-09-02T20:00:00Z', { id: 'a2', q: 'a_q2' });
  const earlier = attempt('a', '2026-09-01T20:00:00Z', { id: 'a1' });
  assert.deepEqual(deriveState([later, earlier]).schedule, deriveState([earlier, later]).schedule);
});

test('extra reps are seen but do not move the schedule', () => {
  const counted = deriveState([attempt('a', '2026-09-01T20:00:00Z')]);
  const withBinge = deriveState([
    attempt('a', '2026-09-01T20:00:00Z'),
    attempt('a', '2026-09-01T21:00:00Z', { id: 'bonus', q: 'a_q9', counted: false }),
  ]);
  assert.deepEqual(withBinge.schedule, counted.schedule, 'intervals unchanged');
  assert.deepEqual(withBinge.seen.a, ['a_q9', 'a_q1'], 'but the question is not asked again');
});

test('the forgetting rule participates in the fold', () => {
  // answered, then nothing for eight months, then answered again
  const { schedule } = deriveState([
    attempt('a', '2026-01-01T20:00:00Z'),
    attempt('a', '2026-01-02T20:00:00Z', { id: 'a2', q: 'a_q2' }),
    attempt('a', '2026-09-01T20:00:00Z', { id: 'a3', q: 'a_q3' }),
  ]);
  assert.equal(schedule.a.reps, 1, 'it re-entered as new rather than continuing the old row');
  assert.equal(schedule.a.interval_days, 1);
});

test('seen keeps the last five question ids, most recent first', () => {
  const attempts = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q, i) =>
    attempt('a', `2026-09-0${i + 1}T20:00:00Z`, { id: `a${i}`, q }));
  const { seen } = deriveState(attempts);
  assert.deepEqual(seen.a, ['q6', 'q5', 'q4', 'q3', 'q2']);
});

// ---------------------------------------------------------------- merge

test('merging two devices is a union by id, and is order-independent', () => {
  const phone = [attempt('a', '2026-09-01T20:00:00Z', { id: 'p1' })];
  const laptop = [attempt('b', '2026-09-01T21:00:00Z', { id: 'l1' })];
  const ab = mergeAttempts(phone, laptop);
  const ba = mergeAttempts(laptop, phone);
  assert.equal(ab.length, 2, 'nothing is lost from either side');
  assert.deepEqual(ab, ba, 'merge is commutative');
});

test('merging is idempotent and de-duplicates by id', () => {
  const log = [attempt('a', '2026-09-01T20:00:00Z', { id: 'x' })];
  assert.equal(mergeAttempts(log, log).length, 1);
  assert.equal(mergeAttempts(mergeAttempts(log, log), log).length, 1);
});

test('two devices that both drilled offline agree after a merge', () => {
  const shared = [attempt('a', '2026-09-01T20:00:00Z', { id: 's1' })];
  const phone = [...shared, attempt('a', '2026-09-02T08:00:00Z', { id: 'p1', q: 'a_q2' })];
  const laptop = [...shared, attempt('b', '2026-09-02T22:00:00Z', { id: 'l1' })];

  const fromPhone = deriveState(mergeAttempts(phone, laptop));
  const fromLaptop = deriveState(mergeAttempts(laptop, phone));

  assert.deepEqual(fromPhone.schedule, fromLaptop.schedule, 'byte-identical schedules');
  assert.equal(fromPhone.schedule.a.reps, 2, 'the phone session survived');
  assert.ok(fromPhone.schedule.b, 'the laptop session survived');
});

// ---------------------------------------------------------------- determinism

test('the Return Path scatter is deterministic across devices', () => {
  const schedule = {};
  for (let i = 0; i < 10; i++) schedule[`c${i}`] = { due: '2026-07-01', lapses: 0 };
  const a = applyReturnPath(schedule, '2026-06-01', '2026-09-03', () => 1);
  const b = applyReturnPath(schedule, '2026-06-01', '2026-09-03', () => 1);
  assert.deepEqual(a.schedule, b.schedule, 'same day, same scatter, every device');
  assert.equal(a.redistributed.length, 10 - SESSION_SIZE);
  for (const id of a.redistributed) {
    const days = daysBetween('2026-09-03', a.schedule[id].due);
    assert.ok(days >= 1 && days <= RETURN_GAP, `${id} pushed to +${days} days`);
  }
});

test('seededRandom is stable for a seed and differs between seeds', () => {
  assert.equal(seededRandom('2026-09-03:sql.join_types')(), seededRandom('2026-09-03:sql.join_types')());
  assert.notEqual(seededRandom('2026-09-03:a')(), seededRandom('2026-09-03:b')());
});

// ---------------------------------------------------------------- selection

const catalog = [
  { id: 'a', domain: 'data', tier: 1, prereqs: [] },
  { id: 'b', domain: 'data', tier: 1, prereqs: [] },
  { id: 'c', domain: 'data', tier: 1, prereqs: [] },
  { id: 'd', domain: 'data', tier: 2, prereqs: [] },
  { id: 'e', domain: 'data', tier: 2, prereqs: [] },
  { id: 'f', domain: 'data', tier: 2, prereqs: [] },
  { id: 'gated', domain: 'data', tier: 3, prereqs: ['a'] },
];
const questionsByConcept = Object.fromEntries(
  catalog.map(c => [c.id, [
    { id: `${c.id}_ex`, type: 'explain', concept_id: c.id },
    { id: `${c.id}_mcq`, type: 'mcq', concept_id: c.id },
  ]]),
);
const plan = (state, extra = {}) => planSession({
  state, catalog, questionsByConcept, today: '2026-09-03', ...extra,
});
/** answered yesterday at quality 5 - due today */
const answeredYesterday = ids => ids.map(id => attempt(id, '2026-09-02T20:00:00Z'));

test('a full queue yields 3 due + 1 new, not 4 due (reserved slots)', () => {
  const out = plan({ attempts: answeredYesterday(['a', 'b', 'c', 'd', 'e']), session_dates: ['2026-09-02'] });
  assert.equal(out.picks.length, SESSION_SIZE);
  assert.equal(out.picks.filter(p => p.slot === 'due').length, SESSION_SIZE - NEW_SLOTS);
  assert.equal(out.picks.filter(p => p.slot === 'new').length, NEW_SLOTS);
  assert.ok(out.due_count > SESSION_SIZE, 'due volume exceeds the cap and new material still appears');
});

test('the new slot falls back to due when there is nothing new left', () => {
  const out = plan({ attempts: answeredYesterday(catalog.map(c => c.id)), session_dates: ['2026-09-02'] });
  assert.equal(out.picks.length, SESSION_SIZE);
  assert.equal(out.picks.filter(p => p.slot === 'new').length, 0);
});

test('a cold start fills the session entirely with new concepts', () => {
  const out = plan({ attempts: [], session_dates: [] });
  assert.equal(out.picks.length, SESSION_SIZE);
  assert.ok(out.picks.every(p => p.slot === 'new'));
  assert.ok(out.picks.every(p => p.concept_id !== 'gated'), 'prereqs are not satisfied yet');
});

test('new material is gated on prereqs having been introduced', () => {
  const out = plan({ attempts: answeredYesterday(['a', 'b', 'c', 'd', 'e', 'f']), session_dates: ['2026-09-02'] });
  assert.ok(out.picks.some(p => p.concept_id === 'gated'), 'unlocked once its prereq has been answered');
});

test('capture-derived concepts take the new slot ahead of curriculum', () => {
  const out = plan({ attempts: [], session_dates: [] }, { workConcepts: ['f'] });
  assert.equal(out.picks[0].concept_id, 'f');
});

test('a concept with no questions is never selected', () => {
  const out = planSession({
    state: { attempts: answeredYesterday(['a']), session_dates: ['2026-09-02'] },
    catalog,
    questionsByConcept: { ...questionsByConcept, a: [] },
    today: '2026-09-03',
  });
  assert.ok(out.picks.every(p => p.concept_id !== 'a'));
});

test('planSession never returns the same concept twice and never mutates input', () => {
  const state = { attempts: answeredYesterday(['a']), session_dates: ['2026-09-02'] };
  const snapshot = JSON.stringify(state);
  const out = plan(state);
  const ids = out.picks.map(p => p.concept_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(JSON.stringify(state), snapshot, 'the caller only ever appends attempts');
});

test('a long absence is absorbed: forgetting rule, then return path, then a normal session', () => {
  const attempts = [
    attempt('a', '2026-01-01T20:00:00Z', { id: 'ancient' }),
    ...['b', 'c', 'd', 'e', 'f', 'gated'].map(id => attempt(id, '2026-07-31T20:00:00Z', { id: `old_${id}` })),
  ];
  const out = plan({ attempts, session_dates: ['2026-07-25'] });

  assert.ok(out.unscheduled.includes('a'), 'past 60 days overdue it leaves the queue');
  assert.equal(out.picks.length, SESSION_SIZE, 'still a normal four-question night');
  const pushed = Object.values(out.schedule).filter(r => daysBetween('2026-09-03', r.due) > 0);
  assert.equal(pushed.length, 2, 'the overflow beyond four was quietly moved forward');
});

// ---------------------------------------------------------------- stats

test('daysActive counts a rolling 30-day window, not a streak', () => {
  const dates = ['2026-09-03', '2026-09-01', '2026-08-20', '2026-07-01'];
  assert.equal(daysActive(dates, '2026-09-03'), 3, 'the July date is outside the window');
  assert.equal(daysActive([], '2026-09-03'), 0);
  // a gap in the middle costs one day, not the whole count - there is no streak to break
  assert.equal(daysActive(['2026-09-03', '2026-09-01'], '2026-09-03'), 2);
});
