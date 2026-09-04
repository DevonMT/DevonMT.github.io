/**
 * Daily Drill - persistence (SPEC.md §6).
 *
 * One localStorage key holding one JSON object. Every read and write is wrapped:
 * localStorage is synchronous, string-only, per-origin, roughly 5MB, and throws
 * outright in some private-browsing modes. A drill session must survive that.
 *
 * `attempts` is append-only. Never overwrite one - reading your own explanation
 * from six weeks ago and watching it improve is the point.
 */

import { mergeAttempts } from './srs.js';

const KEY = 'daily-drill/v1';
export const STATE_VERSION = 2;

/**
 * v2: `schedule`, `seen` and `unscheduled` are no longer stored. They are
 * derived from `attempts` by replay (see srs.js deriveState), which is what
 * makes merging two devices safe.
 */
export const emptyState = () => ({
  version: STATE_VERSION,
  catalog_version: null,
  attempts: [],
  captures: [],
  session_dates: [],
  settings: { show_work_lane: true },
});

let memoryFallback = null;   // used when localStorage is unavailable
export let storageAvailable = true;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    storageAvailable = false;
    console.warn('daily-drill: storage unavailable, this session will not persist', err);
    return memoryFallback ?? emptyState();
  }
}

export function save(state) {
  memoryFallback = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    storageAvailable = false;
    console.warn('daily-drill: could not save', err);
    return false;
  }
}

/**
 * Bring an older stored blob up to the current shape.
 *
 * v1 -> v2 drops the stored `schedule` / `seen` / `unscheduled`. Nothing is lost:
 * every one of them is recomputed from `attempts`, which v1 already kept
 * append-only. A stored version newer than this build is left alone rather than
 * downgraded.
 */
export function migrate(stored) {
  const base = emptyState();
  const state = { ...base, ...stored };
  state.settings = { ...base.settings, ...(stored.settings ?? {}) };
  state.attempts = Array.isArray(stored.attempts) ? stored.attempts : [];
  state.captures = Array.isArray(stored.captures) ? stored.captures : [];
  state.session_dates = Array.isArray(stored.session_dates) ? stored.session_dates : [];
  delete state.schedule;
  delete state.seen;
  delete state.unscheduled;
  state.version = Math.max(STATE_VERSION, stored.version ?? STATE_VERSION);
  return state;
}

// ---------------------------------------------------------------- export / import

/**
 * Export is the only backup there is (§10).
 *
 * Import MERGES. The spec originally said replace, because reconciling two
 * divergent schedules was subtle enough to be dangerous - but that was a
 * consequence of storing the schedule. With attempts as the only truth, merging
 * is a set union of immutable records and the schedule is recomputed by replay,
 * so importing can no longer destroy a session you did on the other device.
 */
export function exportBlob(state) {
  return new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
}

export function exportFilename(today) {
  return `daily-drill-${today}.json`;
}

export function parseImport(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('not a Daily Drill export');
  if (!Array.isArray(parsed.attempts)) throw new Error('not a Daily Drill export');
  return migrate(parsed);
}

const uniqueSorted = arr => [...new Set(arr)].sort();

/**
 * Merge an incoming state into the local one. Conflict-free by construction:
 * attempts and captures union by id, session dates union as a set, and settings
 * stay local because they describe this device (the work lane in particular
 * must never be switched on remotely).
 */
export function mergeState(local, incoming) {
  return {
    ...local,
    version: Math.max(local.version ?? STATE_VERSION, incoming.version ?? STATE_VERSION),
    catalog_version: incoming.catalog_version ?? local.catalog_version,
    attempts: mergeAttempts(local.attempts, incoming.attempts),
    captures: mergeById(local.captures, incoming.captures),
    session_dates: uniqueSorted([...(local.session_dates ?? []), ...(incoming.session_dates ?? [])]).slice(-400),
    settings: local.settings,
  };
}

function mergeById(a = [], b = []) {
  const byId = new Map();
  for (const x of [...a, ...b]) if (x?.id && !byId.has(x.id)) byId.set(x.id, x);
  return [...byId.values()];
}

/**
 * What may leave this device. Work-scoped attempts and every capture stay put:
 * the literal work detail is never committed and never synced (§8).
 */
export function syncPayload(state) {
  return {
    version: state.version,
    catalog_version: state.catalog_version,
    attempts: (state.attempts ?? []).filter(a => a.scope !== 'work'),
    session_dates: state.session_dates ?? [],
  };
}

export function clearAll() {
  memoryFallback = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
}

// ---------------------------------------------------------------- attempts

let counter = 0;
const uid = prefix => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export function recordAttempt(state, { question, answer, met, score, countedTowardSrs, at }) {
  const attempt = {
    id: uid('a'),
    question_id: question.id,
    concept_id: question.concept_id,
    // carried so syncPayload can keep work-lane reps on this device
    scope: question.scope ?? 'curriculum',
    answer,
    result: { met },
    score: Number(score.toFixed(4)),
    rubric_version: question.rubric_version ?? null,
    graded_by: 'self',
    counted_toward_srs: countedTowardSrs,
    created_at: at,
  };
  return { ...state, attempts: [...state.attempts, attempt] };
}

/** Past answers to the same concept, newest first - one tap away, not a menu dive (§3). */
export function attemptsForConcept(state, conceptId) {
  return state.attempts.filter(a => a.concept_id === conceptId).reverse();
}

export function addCapture(state, body) {
  const capture = { id: uid('c'), body, kind: 'text', status: 'new', created_at: new Date().toISOString() };
  return { ...state, captures: [...state.captures, capture] };
}

export function markSessionDay(state, today) {
  if (state.session_dates.includes(today)) return state;
  return { ...state, session_dates: [...state.session_dates, today].slice(-400) };
}
