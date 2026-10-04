/**
 * Recall - the model's second opinion, client side (SPEC.md §9, phase 2).
 *
 * The self-grade is untouched. After a session, each written answer is sent to
 * the platform (which reads it back against the same criteria and returns, per
 * criterion, met or not plus the quote that shows it). What comes back is a
 * grade: its own grow-only record keyed by attempt id, never written into the
 * attempt. srs.js joins the two at replay and schedules on the lower.
 *
 * There are three visible states and never a silent fourth:
 *
 *   unchecked  no grade yet (offline, off, errored, not synced) - picked up later
 *   agreed     checked, and the model found what the writer ticked - shows nothing
 *   differs    checked, and the readers disagree - shown with the quote, or its absence
 *
 * Nothing here blocks a drill: it runs after the session, one attempt at a
 * time, and every failure leaves the attempt "unchecked" and says so.
 */

/** A pass is bounded: each attempt is a model call, and a backlog is worked off over several opens. */
export const MAX_PER_PASS = 8;

/**
 * Only a written answer to a rubric question has anything to read back. The
 * work lane never leaves the device (§8), so it is never graded; a multiple
 * choice pick has no words.
 */
export const gradable = a =>
  a.scope !== 'work'
  && Array.isArray(a.result?.met) && a.result.met.length > 0
  && typeof a.answer === 'string' && a.answer.trim() !== '';

export const criteriaOf = q => q?.rubric?.criteria ?? q?.answer?.rubric?.criteria ?? [];

const gradedIds = state => new Set((state.grades ?? []).map(g => g.attempt_id));

/**
 * Attempts still waiting for a second opinion, newest first, each with what the
 * server needs from the bank: the question and the checklist. An attempt whose
 * question has since changed shape (a different number of criteria, or a newer
 * rubric version) is left out rather than graded against the wrong checklist:
 * it stays "unchecked", which is true.
 */
export function pendingGrades(state, questionById, limit = MAX_PER_PASS) {
  const done = gradedIds(state);
  const out = [];
  for (const attempt of [...(state.attempts ?? [])].reverse()) {
    if (out.length >= limit) break;
    if (!gradable(attempt) || done.has(attempt.id)) continue;
    const q = questionById.get(attempt.question_id);
    const criteria = criteriaOf(q);
    if (!q || criteria.length !== attempt.result.met.length) continue;
    if (attempt.rubric_version != null && q.rubric_version != null && attempt.rubric_version !== q.rubric_version) continue;
    out.push({ attempt, prompt: q.prompt, criteria });
  }
  return out;
}

/** How many answers are checked and how many are still waiting, for Settings. */
export function counts(state) {
  const done = gradedIds(state);
  let checked = 0, waiting = 0;
  for (const a of state.attempts ?? []) {
    if (!gradable(a)) continue;
    if (done.has(a.id)) checked++; else waiting++;
  }
  return { checked, waiting };
}

/** 'unchecked' | 'agreed' | 'differs', or null where grading does not apply. */
export function gradeState(attempt, grade) {
  if (!gradable(attempt)) return null;
  if (!grade || !Array.isArray(grade.verdicts) || grade.verdicts.length !== attempt.result.met.length) return 'unchecked';
  return attempt.result.met.some((m, i) => (m === true) !== (grade.verdicts[i]?.met === true)) ? 'differs' : 'agreed';
}

/**
 * Where the two readers disagree, criterion by criterion.
 *   over   the writer ticked it, the model did not find it (counts as missed)
 *   under  the writer left it unticked, the model found it in the words
 * `quote` on an over is the closest passage the model found, or null when there
 * is none; on an under it is the evidence.
 */
export function differences(attempt, grade, criteria = []) {
  if (gradeState(attempt, grade) !== 'differs') return [];
  const out = [];
  attempt.result.met.forEach((self, i) => {
    const v = grade.verdicts[i];
    const text = criteria[i] ?? `Criterion ${i + 1}`;
    if (self === true && v?.met !== true) out.push({ index: i, kind: 'over', text, quote: v?.quote ?? null });
    else if (self !== true && v?.met === true) out.push({ index: i, kind: 'under', text, quote: v?.quote ?? null });
  });
  return out;
}

/** A grade is only used if it describes this attempt and this checklist. */
const fits = (grade, p) =>
  grade?.attempt_id === p.attempt.id
  && Array.isArray(grade.verdicts) && grade.verdicts.length === p.criteria.length;

/**
 * One pass over what is waiting. `api.gradeAttempt` is sync.js's call; it is
 * injected so this can be tested without a network.
 *
 * Returns what happened, never just "ok": { graded, failed, stopped } where
 * `stopped` says why the pass gave up early (null if it ran to the end):
 *   'unavailable'  the server does not offer grading to this account
 *   'signin'       the session expired
 *   'offline'      the service could not be reached
 *   'error'        the grader or the platform is failing; try again on a later open
 * Per-attempt refusals (not synced yet, a checklist mismatch, a work-lane
 * answer) count as `failed` and the pass moves on: those attempts stay unchecked.
 */
export async function runPass({ state, questionById, api, onGrade, limit = MAX_PER_PASS }) {
  const graded = [];
  let failed = 0;
  for (const p of pendingGrades(state, questionById, limit)) {
    try {
      const { grade } = await api.gradeAttempt({
        attempt_id: p.attempt.id, prompt: p.prompt, criteria: p.criteria,
      });
      if (!fits(grade, p)) { failed++; continue; }
      graded.push(grade);
      onGrade?.(grade);
    } catch (err) {
      const code = err?.code ?? 'offline';
      if (code === 'noaccess') return { graded, failed, stopped: 'unavailable' };
      if (code === 'signin' || code === 'offline') return { graded, failed, stopped: code };
      if (code === 'http' && !(err.status < 500)) return { graded, failed, stopped: 'error' };
      failed++;
    }
  }
  return { graded, failed, stopped: null };
}
