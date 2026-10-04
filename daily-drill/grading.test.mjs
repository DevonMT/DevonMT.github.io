/**
 * Tests for the model's second opinion on the client (SPEC.md §9, phase 2).
 *
 *   node --test daily-drill/grading.test.mjs
 *
 * No network and no model: the platform is a stub. What is under test is the
 * rule that decides what a grade does, because that rule is what makes it safe
 * to merge two devices and safe to trust a silent screen:
 *
 *   - the lower of the two readings schedules the concept
 *   - a grade can only lower a score
 *   - grades are a grow-only set, joined to attempts at replay
 *   - three visible states, and a failed pass never reads as agreement
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveState, planSession, mergeAttempts, mergeGrades, effectiveMet, effectiveScore, ratioFromRubric,
} from '../daily-drill/app/js/srs.js';

// --- a minimal localStorage + fetch, so the browser modules load under node ---

const kv = new Map();
globalThis.localStorage = {
  getItem: k => (kv.has(k) ? kv.get(k) : null),
  setItem: (k, v) => kv.set(k, String(v)),
  removeItem: k => kv.delete(k),
};
globalThis.window = globalThis;

/** The platform's answers, set per test. */
let respond = () => new Response('{}', { status: 200 });
const requests = [];
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, credentials: init.credentials });
  return respond(new URL(url).pathname, init);
};

const sync = await import('../daily-drill/app/js/sync.js');
const grading = await import('../daily-drill/app/js/grading.js');
const { emptyState, mergeState, syncPayload, migrate } = await import('../daily-drill/app/js/store.js');

beforeEach(() => {
  kv.clear();
  requests.length = 0;
  respond = () => new Response('{}', { status: 200 });
  sync.setEndpoint('https://sync.example.com');
  sync.enableSync();
});

// --- fixtures ---------------------------------------------------------------

const attempt = (id, at, met, extra = {}) => ({
  id, concept_id: 'a', question_id: `q_${id}`, scope: 'curriculum',
  answer: 'what I wrote', result: { met }, score: ratioFromRubric(met),
  rubric_version: 1, created_at: at, counted_toward_srs: true, ...extra,
});
const grade = (attempt_id, mets, quotes = []) => ({
  attempt_id,
  prompt_version: 1,
  verdicts: mets.map((met, i) => ({ met, quote: met ? (quotes[i] ?? 'words') : (quotes[i] ?? null) })),
  graded_at: '2026-09-02T00:00:00Z',
});
const question = (id, criteria, extra = {}) => ({ id, prompt: `Prompt ${id}`, rubric: { criteria }, rubric_version: 1, ...extra });
const qmap = (...qs) => new Map(qs.map(q => [q.id, q]));

// --- scheduling: the lower of the two ----------------------------------------

test('a criterion counts as met only if BOTH readers said met', () => {
  assert.deepEqual(effectiveMet([true, true, false], grade('x', [true, false, true])), [true, false, false]);
});

test('no grade, or one that does not fit, leaves the self-grade alone', () => {
  const met = [true, true, false];
  assert.equal(effectiveMet(met, undefined), met);
  assert.equal(effectiveMet(met, grade('x', [true, true])), met, 'wrong number of verdicts');
  assert.equal(effectiveMet(null, grade('x', [true])), null, 'a static attempt has no rubric to join');
  assert.equal(effectiveScore({ score: 0.5, result: { met } }, undefined), 0.5);
});

test('the model can only lower a score, never raise it', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, false, false, false]);
  assert.equal(effectiveScore(a, grade('a1', [true, true, true, true])), 0.25, 'a generous model changes nothing');
  assert.equal(effectiveScore(a, grade('a1', [false, true, true, true])), 0, 'a strict one does');
});

test('an over-credited answer schedules on the lower reading', () => {
  // ticked 3 of 4 (a pass); the model finds 1 of 4 (a lapse)
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true, true, false]);
  const plain = deriveState([a]).schedule.a;
  const graded = deriveState([a], [grade('a1', [true, false, false, false])]).schedule.a;
  assert.equal(plain.reps, 1);
  assert.equal(plain.due, '2026-09-02');
  assert.equal(graded.reps, 0, 'the lapse resets the run');
  assert.equal(graded.lapses, 1);
  assert.equal(graded.last_score, 0.25);
});

test('agreement changes nothing at all', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true, false]);
  assert.deepEqual(deriveState([a], [grade('a1', [true, true, false])]), deriveState([a]));
});

test('a model that finds what the writer missed does not rescue the concept', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, false, false]);
  assert.deepEqual(deriveState([a], [grade('a1', [true, true, true])]), deriveState([a]),
    'either reader saying missed counts as missed');
});

test('intervals count from answered_at, not from when the grade landed', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true, true]);
  const late = { ...grade('a1', [true, false, false]), graded_at: '2026-09-20T00:00:00Z' };
  const row = deriveState([a], [late]).schedule.a;
  assert.equal(row.last_answered_at, '2026-09-01T20:00:00Z');
  assert.equal(row.due, '2026-09-02');
});

test('a grade for some other attempt is inert', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true]);
  assert.deepEqual(deriveState([a], [grade('other', [false, false])]), deriveState([a]));
});

test('planSession replays with the grades held in state', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true, true]);
  const run = grades => planSession({
    state: { attempts: [a], grades, session_dates: [] },
    catalog: [{ id: 'a', tier: 1, prereqs: [] }],
    questionsByConcept: { a: [{ id: 'q_a1', type: 'explain' }] },
    today: '2026-09-02',
  });
  assert.equal(run([]).schedule.a.reps, 1);
  assert.equal(run([grade('a1', [false, false, false])]).schedule.a.reps, 0);
});

// --- merging -----------------------------------------------------------------

test('grades merge by attempt id as a grow-only set, in any order', () => {
  const g1 = { ...grade('a1', [true]), graded_at: '2026-09-02T00:00:00Z' };
  const g2 = { ...grade('a2', [false]), graded_at: '2026-09-03T00:00:00Z' };
  assert.deepEqual(mergeGrades([g1], [g2, g1]), mergeGrades([g2], [g1]));
  assert.equal(mergeGrades([g1], [g2, g1]).length, 2);
  assert.deepEqual(mergeGrades(undefined, undefined), []);
});

test('two devices holding different grades converge on one schedule', () => {
  const a1 = attempt('a1', '2026-09-01T20:00:00Z', [true, true]);
  const a2 = attempt('a2', '2026-09-02T20:00:00Z', [true, true]);
  const g1 = grade('a1', [true, false]);
  const g2 = grade('a2', [false, false]);
  assert.deepEqual(
    deriveState(mergeAttempts([a1], [a2]), mergeGrades([g1], [g2])),
    deriveState(mergeAttempts([a2], [a1]), mergeGrades([g2], [g1])));
});

test('an old blob gains an empty grade set and the toggle starts off', () => {
  const v = migrate({ version: 2, attempts: [attempt('a1', '2026-09-01T20:00:00Z', [true])] });
  assert.deepEqual(v.grades, []);
  assert.equal(v.settings.model_grading, false, 'answers leave the device, so never on by default');
});

test('mergeState unions grades, tolerates a server that sends none, and keeps the local toggle', () => {
  const local = { ...emptyState(), grades: [grade('a1', [true])], settings: { show_work_lane: true, model_grading: false } };
  const merged = mergeState(local, { ...emptyState(), grades: [grade('a2', [true]), grade('a1', [true])], settings: { model_grading: true } });
  assert.deepEqual(merged.grades.map(g => g.attempt_id).sort(), ['a1', 'a2']);
  assert.equal(merged.settings.model_grading, false);
  assert.deepEqual(mergeState(local, { attempts: [] }).grades, local.grades, 'losing no grade to a payload without any');
});

test('grades never leave the device: the server writes them', () => {
  const state = { ...emptyState(), attempts: [attempt('a1', '2026-09-01T20:00:00Z', [true])], grades: [grade('a1', [true])] };
  assert.equal('grades' in syncPayload(state), false);
});

// --- the three visible states -------------------------------------------------

test('gradable: written rubric answers only, never the work lane', () => {
  const ok = attempt('a1', '2026-09-01T20:00:00Z', [true, false]);
  assert.equal(grading.gradable(ok), true);
  assert.equal(grading.gradable({ ...ok, scope: 'work' }), false, 'the work lane never leaves the device');
  assert.equal(grading.gradable({ ...ok, answer: '  ' }), false);
  assert.equal(grading.gradable({ ...ok, result: { met: null } }), false, 'a multiple-choice pick has no words');
});

test('not checked, checked and agreed, checked and differs', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true, false]);
  assert.equal(grading.gradeState(a, undefined), 'unchecked');
  assert.equal(grading.gradeState(a, grade('a1', [true, true, false])), 'agreed');
  assert.equal(grading.gradeState(a, grade('a1', [true, false, false])), 'differs');
  assert.equal(grading.gradeState(a, grade('a1', [true, true, true])), 'differs', 'the model finding more is a difference too');
  assert.equal(grading.gradeState(a, grade('a1', [true, true])), 'unchecked', 'a grade that does not fit is not a grade');
  assert.equal(grading.gradeState({ ...a, answer: '' }, undefined), null, 'not applicable shows nothing');
});

test('agreement shows nothing', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, false]);
  assert.deepEqual(grading.differences(a, grade('a1', [true, false]), ['one', 'two']), []);
});

test('an over-credited criterion is shown with the closest quote, or with its absence', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, true, true]);
  const g = grade('a1', [true, false, false], [undefined, 'RANGE is the default', null]);
  assert.deepEqual(grading.differences(a, g, ['first', 'second', 'third']), [
    { index: 1, kind: 'over', text: 'second', quote: 'RANGE is the default' },
    { index: 2, kind: 'over', text: 'third', quote: null },
  ]);
});

test('a criterion left unticked but found in the words is shown with its evidence', () => {
  const a = attempt('a1', '2026-09-01T20:00:00Z', [true, false]);
  const g = grade('a1', [true, true], [undefined, 'I did say this']);
  assert.deepEqual(grading.differences(a, g, ['one', 'two']), [{ index: 1, kind: 'under', text: 'two', quote: 'I did say this' }]);
});

test('counts say how many are read back and how many are waiting', () => {
  const state = {
    attempts: [
      attempt('a1', '2026-09-01T20:00:00Z', [true]),
      attempt('a2', '2026-09-02T20:00:00Z', [true]),
      attempt('a3', '2026-09-03T20:00:00Z', [true], { scope: 'work' }),
      attempt('a4', '2026-09-04T20:00:00Z', null),
    ],
    grades: [grade('a1', [true])],
  };
  assert.deepEqual(grading.counts(state), { checked: 1, waiting: 1 });
});

// --- what gets sent ----------------------------------------------------------

test('pending: newest first, with the bank question and checklist, skipping what is graded', () => {
  const state = {
    attempts: [attempt('a1', '2026-09-01T20:00:00Z', [true, true]), attempt('a2', '2026-09-02T20:00:00Z', [true, true])],
    grades: [grade('a1', [true, true])],
  };
  const qs = qmap(question('q_a1', ['x', 'y']), question('q_a2', ['p', 'q']));
  const p = grading.pendingGrades(state, qs);
  assert.deepEqual(p.map(x => x.attempt.id), ['a2']);
  assert.equal(p[0].prompt, 'Prompt q_a2');
  assert.deepEqual(p[0].criteria, ['p', 'q']);
});

test('an attempt whose checklist has changed is left unchecked, not graded against the wrong one', () => {
  const state = { attempts: [attempt('a1', '2026-09-01T20:00:00Z', [true, true])], grades: [] };
  assert.equal(grading.pendingGrades(state, qmap(question('q_a1', ['only one']))).length, 0, 'different count');
  assert.equal(grading.pendingGrades(state, qmap(question('q_a1', ['x', 'y'], { rubric_version: 2 }))).length, 0, 'newer rubric');
  assert.equal(grading.pendingGrades(state, qmap()).length, 0, 'question gone from the bank');
});

test('a pass is bounded', () => {
  const attempts = Array.from({ length: 20 }, (_, i) => attempt(`a${i}`, `2026-09-01T20:${String(i).padStart(2, '0')}:00Z`, [true]));
  const qs = qmap(...attempts.map(a => question(a.question_id, ['x'])));
  assert.equal(grading.pendingGrades({ attempts, grades: [] }, qs).length, grading.MAX_PER_PASS);
});

// --- a pass ------------------------------------------------------------------

const passState = () => ({
  attempts: [attempt('a1', '2026-09-01T20:00:00Z', [true, true]), attempt('a2', '2026-09-02T20:00:00Z', [true, true])],
  grades: [],
});
const passQs = () => qmap(question('q_a1', ['x', 'y']), question('q_a2', ['p', 'q']));

test('a pass hands every grade back as it arrives', async () => {
  const got = [];
  const res = await grading.runPass({
    state: passState(), questionById: passQs(),
    api: { gradeAttempt: async ({ attempt_id }) => ({ grade: grade(attempt_id, [true, false]), cached: false }) },
    onGrade: g => got.push(g.attempt_id),
  });
  assert.deepEqual(got, ['a2', 'a1']);
  assert.deepEqual({ graded: res.graded.length, failed: res.failed, stopped: res.stopped }, { graded: 2, failed: 0, stopped: null });
});

test('a grade that does not describe the attempt is refused, and the attempt stays unchecked', async () => {
  const res = await grading.runPass({
    state: passState(), questionById: passQs(),
    api: { gradeAttempt: async () => ({ grade: grade('someone-else', [true, true]) }) },
  });
  assert.equal(res.graded.length, 0);
  assert.equal(res.failed, 2);
});

test('why a pass stopped is always reported', async () => {
  const stopWith = async err => (await grading.runPass({
    state: passState(), questionById: passQs(),
    api: { gradeAttempt: async () => { throw err; } },
  }));
  assert.equal((await stopWith(Object.assign(new Error('x'), { code: 'noaccess' }))).stopped, 'unavailable');
  assert.equal((await stopWith(Object.assign(new Error('x'), { code: 'signin' }))).stopped, 'signin');
  assert.equal((await stopWith(new Error('network'))).stopped, 'offline');
  assert.equal((await stopWith(Object.assign(new Error('x'), { code: 'http', status: 503 }))).stopped, 'error');
  assert.equal((await stopWith(Object.assign(new Error('x'), { code: 'http', status: 502 }))).stopped, 'error', 'unparseable stops the pass');
});

test('a per-attempt refusal skips that attempt and carries on', async () => {
  let n = 0;
  const res = await grading.runPass({
    state: passState(), questionById: passQs(),
    api: { gradeAttempt: async ({ attempt_id }) => {
      if (n++ === 0) throw Object.assign(new Error('not synced'), { code: 'http', status: 404 });
      return { grade: grade(attempt_id, [true, true]) };
    } },
  });
  assert.deepEqual({ graded: res.graded.length, failed: res.failed, stopped: res.stopped }, { graded: 1, failed: 1, stopped: null });
});

// --- the network calls --------------------------------------------------------

test('gradeAttempt posts the id, the question and the checklist, with the session cookie, and nothing else', async () => {
  respond = () => new Response(JSON.stringify({ grade: grade('a1', [true]), cached: false }), { status: 200 });
  const out = await sync.gradeAttempt({ attempt_id: 'a1', prompt: 'Why?', criteria: ['x'], answer: 'forged', extra: 1 });
  assert.equal(out.cached, false);
  const r = requests[0];
  assert.match(r.url, /\/grade$/);
  assert.equal(r.method, 'POST');
  assert.equal(r.credentials, 'include');
  assert.deepEqual(r.body, { attempt_id: 'a1', prompt: 'Why?', criteria: ['x'] }, 'the answer is read from the server, never sent');
});

test('gradingAvailable reflects the server, and any failure reads as no', async () => {
  respond = () => new Response(JSON.stringify({ ok: true, grading: true }), { status: 200 });
  assert.equal(await sync.gradingAvailable(), true);
  respond = () => new Response(JSON.stringify({ ok: true, grading: false }), { status: 200 });
  assert.equal(await sync.gradingAvailable(), false);
  respond = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  assert.equal(await sync.gradingAvailable(), false, 'an older server says nothing, which is no');
  respond = () => new Response('{}', { status: 401 });
  assert.equal(await sync.gradingAvailable(), false);
});

test('a 403 from /grade is code noaccess, and a server error carries its status', async () => {
  respond = () => new Response('{}', { status: 403 });
  await assert.rejects(sync.gradeAttempt({ attempt_id: 'a', prompt: 'p', criteria: ['x'] }), { code: 'noaccess' });
  respond = () => new Response('{}', { status: 502 });
  await assert.rejects(sync.gradeAttempt({ attempt_id: 'a', prompt: 'p', criteria: ['x'] }), { code: 'http', status: 502 });
});

test('pulling state merges the server grades in', async () => {
  const local = { ...emptyState(), attempts: [attempt('a1', '2026-09-01T20:00:00Z', [true])] };
  respond = () => new Response(JSON.stringify({ attempts: local.attempts, grades: [grade('a1', [false])], session_dates: [] }), { status: 200 });
  const { state } = await sync.pull(local);
  assert.deepEqual(state.grades.map(g => g.attempt_id), ['a1']);
});
