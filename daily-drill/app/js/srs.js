/**
 * Daily Drill - scheduling (SPEC.md §7).
 *
 * Pure functions only: no DOM, no network, no storage, no reading of the clock.
 * Every function that needs "today" or randomness takes it as an argument, so
 * the whole module is deterministic under test.
 *
 * Dates are 'YYYY-MM-DD' day strings throughout. Timestamps are ISO strings and
 * are reduced to a day with toDay() at the boundary.
 */

export const SESSION_SIZE = 4;
export const NEW_SLOTS = 1;
export const FORGET_DAYS = 60;
export const RETURN_GAP = 14;
export const MIN_EASE = 1.8;   // above SM-2's 1.3, on purpose (§7)
export const DEFAULT_EASE = 2.5;
export const SEEN_CAP = 5;

// ---------------------------------------------------------------- days

const DAY_MS = 86_400_000;

/** '2026-09-03T22:41:00Z' or '2026-09-03' -> '2026-09-03' */
export function toDay(iso) {
  return String(iso).slice(0, 10);
}

const dayMs = day => Date.parse(`${toDay(day)}T00:00:00Z`);

export function addDays(day, n) {
  return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

// ---------------------------------------------------------------- grading

/**
 * Rubric ratio -> SM-2 quality (§7). The seam between grading and scheduling;
 * every boundary here is unit-tested.
 */
export function qualityFromRatio(ratio) {
  if (ratio >= 0.8) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;   // lowest passing grade
  if (ratio >= 0.2) return 2;
  return 1;
}

export const isLapse = quality => quality < 3;

/** Rubric self-grade: array of booleans -> ratio met. */
export function ratioFromRubric(met) {
  if (!Array.isArray(met) || met.length === 0) return 0;
  return met.filter(Boolean).length / met.length;
}

const sameSet = (a, b) => {
  const A = new Set(a), B = new Set(b);
  return A.size === B.size && [...A].every(x => B.has(x));
};

const norm = s => String(s).trim().toLowerCase();

/**
 * Statically-graded types also produce a ratio (§7).
 * mcq / cloze / predict_output / ordering / spot_error are 1 or 0;
 * multi and matching give a natural partial ratio;
 * tf_why averages the verdict with its rubric ratio.
 *
 * `response` shapes: mcq {choice}, multi {choices}, cloze {texts},
 * spot_error {line}, predict_output {text}, ordering {order},
 * matching {pairs}, tf_why {verdict, met}.
 */
export function scoreStatic(question, response) {
  const a = question.answer ?? {};
  switch (question.type) {
    case 'mcq':
      return response.choice === a.correct ? 1 : 0;

    case 'multi': {
      // partial credit: right picks minus wrong picks, over the number that were right
      const correct = new Set(a.correct);
      const picked = new Set(response.choices ?? []);
      let hit = 0, miss = 0;
      for (const i of picked) (correct.has(i) ? hit++ : miss++);
      return Math.max(0, (hit - miss) / correct.size);
    }

    case 'cloze': {
      const blanks = a.blanks ?? [];
      const texts = response.texts ?? [];
      if (!blanks.length) return 0;
      const ok = blanks.every((b, i) => (b.accept ?? []).some(x => norm(x) === norm(texts[i] ?? '')));
      return ok ? 1 : 0;
    }

    case 'spot_error':
      return response.line === a.bad_line ? 1 : 0;

    case 'predict_output':
      return (a.accept ?? []).some(x => norm(x) === norm(response.text ?? '')) ? 1 : 0;

    case 'ordering':
      return sameOrder(response.order, a.correct_order) ? 1 : 0;

    case 'matching': {
      const pairs = a.pairs ?? [];
      if (!pairs.length) return 0;
      const key = new Map(pairs.map(([l, r]) => [l, r]));
      const got = response.pairs ?? [];
      const hit = got.filter(([l, r]) => key.get(l) === r).length;
      return hit / pairs.length;
    }

    case 'tf_why': {
      const verdict = response.verdict === a.correct ? 1 : 0;
      const rubric = ratioFromRubric(response.met ?? []);
      return (verdict + rubric) / 2;
    }

    default:
      return ratioFromRubric(response.met ?? []);
  }
}

const sameOrder = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- sm-2

export const newScheduleRow = () => ({
  ease: DEFAULT_EASE, interval_days: 0, reps: 0, lapses: 0,
});

/**
 * One SM-2 step (§7). Returns a NEW row; does not mutate `row`.
 * `answeredAt` is when the answer was given, never when a grade landed - if
 * grading is asynchronous, keying off the grade collapses offline nights.
 */
export function schedule(row, quality, answeredAt) {
  const s = { ...newScheduleRow(), ...(row ?? {}) };
  let interval;

  if (!isLapse(quality)) {
    if (s.reps === 0) interval = 1;
    else if (s.reps === 1) interval = 6;
    else interval = Math.round(s.interval_days * s.ease);
    s.reps += 1;
  } else {
    s.reps = 0;
    interval = 1;
    s.lapses += 1;
  }

  const drift = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  s.ease = Math.max(MIN_EASE, Number((s.ease + drift).toFixed(4)));
  s.interval_days = interval;
  s.due = addDays(toDay(answeredAt), interval);
  s.last_answered_at = answeredAt;
  return s;
}

/** Grade one answer and return the next schedule row for its concept. */
export function applyAnswer(row, ratio, answeredAt) {
  const next = schedule(row, qualityFromRatio(ratio), answeredAt);
  next.last_score = Number(ratio.toFixed(4));
  return next;
}

// ---------------------------------------------------------------- queue hygiene

/**
 * Forgetting rule (§7 step 1): anything overdue by more than FORGET_DAYS leaves
 * the queue entirely and re-enters later as new, with no schedule history.
 * Without this, a long absence compounds forever.
 */
export function applyForgetting(schedule, unscheduled, today) {
  const kept = {};
  const dropped = [];
  for (const [id, row] of Object.entries(schedule)) {
    if (row.due && daysBetween(row.due, today) > FORGET_DAYS) dropped.push(id);
    else kept[id] = row;
  }
  return {
    schedule: kept,
    unscheduled: [...new Set([...(unscheduled ?? []), ...dropped])],
    dropped,
  };
}

/**
 * Return Path (§7 step 2): after a gap longer than RETURN_GAP, keep the
 * SESSION_SIZE highest-value overdue concepts and silently push the rest across
 * the next two weeks. Coming back after three weeks should look like a normal
 * night, never a backlog wall.
 */
export function applyReturnPath(schedule, lastSessionDay, today, tierOf) {
  if (!lastSessionDay || daysBetween(lastSessionDay, today) <= RETURN_GAP) {
    return { schedule, redistributed: [] };
  }
  const overdue = Object.entries(schedule)
    .filter(([, r]) => r.due && daysBetween(r.due, today) > 0)
    .sort(byValue(tierOf));

  const next = { ...schedule };
  const redistributed = [];
  for (const [id] of overdue.slice(SESSION_SIZE)) {
    // seeded, not random: two devices must agree on where this landed
    const roll = seededRandom(`${today}:${id}`)();
    next[id] = { ...next[id], due: addDays(today, 1 + Math.floor(roll * RETURN_GAP)) };
    redistributed.push(id);
  }
  return { schedule: next, redistributed };
}

/**
 * A tiny deterministic PRNG (mulberry32 over an xfnv1a-style string hash).
 *
 * The Return Path has to scatter overdue items, but Math.random() would make
 * two devices disagree about due dates with no way to reconcile them. Seeding
 * from (day + concept id) gives the same scatter everywhere, forever, and it is
 * derived rather than stored - so there is nothing extra to sync.
 */
export function seededRandom(seed) {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** most lapses first, then lowest tier, then longest overdue (§7 step 3) */
const byValue = tierOf => ([idA, a], [idB, b]) =>
  (b.lapses ?? 0) - (a.lapses ?? 0)
  || (tierOf(idA) ?? 9) - (tierOf(idB) ?? 9)
  || String(a.due).localeCompare(String(b.due))
  || idA.localeCompare(idB);

// ---------------------------------------------------------------- derived state

/**
 * THE ATTEMPT LOG IS THE ONLY AUTHORITATIVE STATE.
 *
 * `schedule` is a pure fold of SM-2 over a concept's attempts in answered order,
 * and `seen` is just the last few question ids per concept. Neither is stored,
 * because storing them is what makes two devices able to disagree.
 *
 * Deriving them instead buys the property that makes cross-device sync safe:
 * merging two devices is a set union of immutable attempts, and both sides then
 * compute byte-identical schedules by replay. No last-write-wins, no lost
 * session, no merge heuristics.
 */

/** Attempts in the order they were answered; ties broken by id so it is total. */
export const sortAttempts = attempts =>
  [...attempts].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));

/**
 * Union two attempt logs by id. Attempts are immutable, so a grow-only set is
 * all the merge logic there is - this is the whole conflict-resolution story.
 */
export function mergeAttempts(a = [], b = []) {
  const byId = new Map();
  for (const x of [...a, ...b]) if (x && x.id && !byId.has(x.id)) byId.set(x.id, x);
  return sortAttempts([...byId.values()]);
}

/**
 * Replay the log into schedule + seen.
 *
 * The forgetting rule participates in the fold: if a concept was already more
 * than FORGET_DAYS overdue when the next attempt arrived, that attempt starts a
 * fresh row rather than continuing the old one - "re-enters as new, with no
 * schedule history" (§7).
 */
export function deriveState(attempts) {
  const schedule = {};
  const seenLists = {};

  for (const a of sortAttempts(attempts)) {
    if (!a.concept_id) continue;

    // every rep counts as "seen", including extra reps beyond the session cap
    const list = (seenLists[a.concept_id] ??= []);
    if (a.question_id) {
      const at = list.indexOf(a.question_id);
      if (at >= 0) list.splice(at, 1);
      list.unshift(a.question_id);
      list.length = Math.min(list.length, SEEN_CAP);
    }

    // ...but only counted reps move the schedule (§7: a binge must not reshape it)
    if (a.counted_toward_srs === false) continue;

    let row = schedule[a.concept_id];
    if (row?.due && daysBetween(row.due, toDay(a.created_at)) > FORGET_DAYS) row = undefined;
    schedule[a.concept_id] = applyAnswer(row, a.score ?? 0, a.created_at);
  }

  return { schedule, seen: seenLists };
}

// ---------------------------------------------------------------- selection

/** A prereq counts as satisfied once the concept has been introduced. */
const prereqsMet = (concept, schedule) => (concept.prereqs ?? []).every(p => p in schedule);

export const FREE_TYPES = ['explain', 'critique', 'when_not', 'breaks_first', 'to_stakeholder', 'push_back', 'estimate'];
const FREE = new Set(FREE_TYPES);
/** tf_why grades its verdict statically, so it counts as a static rep */
export const isFreeText = type => FREE.has(type);

/** A session mixes one or two free-text reps with two or three static ones (§5). */
export const FREE_TEXT_PER_SESSION = 2;

/**
 * Pick a question for a concept: one not shown recently, preferring a type that
 * has not come up recently either (§7 step 6). Question rows are interchangeable
 * renderings of one memory - that is why the schedule keys on the concept.
 *
 * `prefer` is the session-level mix budget ('free' | 'static'); it is a
 * preference, not a filter, so a concept that only carries one kind still gets
 * asked rather than being skipped.
 */
export function pickQuestion(questions, seenIds = [], prefer = null) {
  if (!questions?.length) return null;
  const seen = new Set(seenIds);
  const recentTypes = new Set(questions.filter(q => seen.has(q.id)).map(q => q.type));

  const unseen = questions.filter(q => !seen.has(q.id));
  let pool = unseen.length ? unseen : questions;            // everything seen: cycle round

  if (prefer) {
    const wanted = pool.filter(q => isFreeText(q.type) === (prefer === 'free'));
    if (wanted.length) pool = wanted;
  }
  const fresh = pool.filter(q => !recentTypes.has(q.type));
  return (fresh.length ? fresh : pool)[0];
}

export function rememberSeen(seen, conceptId, questionId, cap = SEEN_CAP) {
  const prev = (seen[conceptId] ?? []).filter(id => id !== questionId);
  return { ...seen, [conceptId]: [questionId, ...prev].slice(0, cap) };
}

/**
 * Build one session (§7 "Selection").
 *
 * Reserved slots, not strict priority: 3 due + 1 new. Ranking due above
 * everything means new material is starved permanently once due volume reaches
 * the cap - and that state arrives within weeks and never lifts.
 *
 * @param {object}   opts.state              { schedule, seen, unscheduled, session_dates }
 * @param {object[]} opts.catalog            concept rows
 * @param {object}   opts.questionsByConcept concept_id -> question rows
 * @param {string}   opts.today              'YYYY-MM-DD'
 * @param {string[]} opts.workConcepts       capture-derived concept ids, offered first for the new slot
 * @param {function} opts.rng                injectable for tests
 * @returns {{ picks, state, due_count }}    due_count is for tests only - never display it (§7)
 */
export function planSession({ state, catalog, questionsByConcept, today, workConcepts = [] }) {
  const byId = new Map(catalog.map(c => [c.id, c]));
  const tierOf = id => byId.get(id)?.tier;
  const has = id => (questionsByConcept[id] ?? []).length > 0;

  // schedule and seen are derived from the attempt log, never read from storage
  const derived = deriveState(state.attempts ?? []);
  const forgot = applyForgetting(derived.schedule, [], today);
  const lastSession = (state.session_dates ?? []).slice(-1)[0];
  const returned = applyReturnPath(forgot.schedule, lastSession, today, tierOf);
  const sched = returned.schedule;

  const due = Object.entries(sched)
    .filter(([id, r]) => r.due && daysBetween(r.due, today) >= 0 && has(id))
    .sort(byValue(tierOf))
    .map(([id]) => id);

  const unscheduled = new Set(forgot.unscheduled);
  const isNew = id => !(id in sched) && has(id);
  const eligible = id => isNew(id) && prereqsMet(byId.get(id), sched);

  const fresh = [
    // work-derived concepts from recent captures first, then curriculum
    ...workConcepts.filter(eligible),
    ...catalog
      .filter(c => !workConcepts.includes(c.id) && eligible(c.id))
      // introduce the foundations first, and prefer concepts that unlock others
      .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
      .map(c => c.id),
  ];
  // a concept dropped by the forgetting rule re-enters as new, but only behind
  // genuinely untouched material
  fresh.push(...[...unscheduled].filter(eligible));

  const chosen = [];
  const take = (list, slot, n) => {
    for (const id of list) {
      if (chosen.length >= SESSION_SIZE) return;
      if (chosen.filter(c => c.slot === slot).length >= n) return;
      if (!chosen.some(c => c.concept_id === id)) chosen.push({ concept_id: id, slot });
    }
  };

  take(due, 'due', SESSION_SIZE - NEW_SLOTS);
  take(fresh, 'new', NEW_SLOTS);
  // short of a full session: backfill from remaining due, then remaining new
  take(due, 'due', SESSION_SIZE);
  take(fresh, 'new', SESSION_SIZE);

  let seen = derived.seen;
  const picks = [];
  let freeUsed = 0;
  for (const { concept_id, slot } of chosen.slice(0, SESSION_SIZE)) {
    // spend the free-text budget first, then ask for static reps
    const prefer = freeUsed < FREE_TEXT_PER_SESSION ? 'free' : 'static';
    const question = pickQuestion(questionsByConcept[concept_id], seen[concept_id], prefer);
    if (!question) continue;
    if (isFreeText(question.type)) freeUsed++;
    seen = rememberSeen(seen, concept_id, question.id);
    picks.push({ concept_id, slot, question });
  }

  // Nothing to write back: the caller's only job is to append attempts.
  // due_count is returned for tests and must never be displayed (§7).
  return { picks, due_count: due.length, schedule: sched, unscheduled: [...unscheduled] };
}

/** Rolling "days active in the last 30" - the only stat the app shows (§3). */
export function daysActive(sessionDates, today, window = 30) {
  return (sessionDates ?? []).filter(d => {
    const age = daysBetween(d, today);
    return age >= 0 && age < window;
  }).length;
}
