/**
 * Daily Drill - question shape rules, shared by every path into the bank.
 *
 * This module makes NO network calls and has no dependencies. It is the single
 * gate every question passes through, whether it was hand-authored in a chat
 * session (import-drafts.mjs — the normal workflow) or drafted by an API call
 * (generate-bank.mjs — optional, and not used).
 */

export const STATIC_TYPES = ['mcq', 'multi', 'cloze', 'spot_error', 'predict_output', 'ordering', 'matching', 'tf_why'];
export const FREE_TYPES = ['explain', 'critique', 'when_not', 'breaks_first', 'to_stakeholder', 'push_back', 'estimate'];
export const ALL_TYPES = [...STATIC_TYPES, ...FREE_TYPES];
export const RUBRIC_VERSION = 1;

/** tf_why is half self-graded, so it counts as free-text for the session-mix rule */
export const isFree = t => FREE_TYPES.includes(t);

export const today = () => new Date().toISOString().slice(0, 10);
export const slug = id => id.replace(/[^a-z0-9]+/gi, '_');

export function nextId(conceptId, type, taken) {
  const base = `q_${slug(conceptId)}_${type}`;
  for (let n = 1; n < 1000; n++) {
    const id = `${base}_${String(n).padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
  throw new Error(`ran out of ids for ${base}`);
}

// ---------------------------------------------------------------- validation

// SPEC.md §9: "Explains it well" is a bad criterion. A criterion must be
// mechanically checkable, or self-grading means nothing.
const VAGUE = /\b(well|good|clearly|properly|correctly|thoroughly|appropriate|solid|strong understanding|demonstrates)\b/i;

export function checkCriteria(q, errs) {
  const c = q.criteria;
  if (!Array.isArray(c) || c.length < 3 || c.length > 5) return errs.push('rubric needs 3-5 criteria');
  c.forEach((s, i) => {
    if (typeof s !== 'string' || s.length < 15) errs.push(`criterion ${i} too short to check`);
    else if (VAGUE.test(s)) errs.push(`criterion ${i} is vague ("${s.slice(0, 40)}...")`);
  });
}

const isPermutation = (arr, n) =>
  Array.isArray(arr) && arr.length === n && new Set(arr).size === n && arr.every(i => i >= 0 && i < n);

export function validate(q, allowedConcepts) {
  const errs = [];
  if (!allowedConcepts.has(q.concept_id)) errs.push(`concept_id "${q.concept_id}" not in this batch`);
  if (!q.prompt || q.prompt.trim().length < 20) errs.push('prompt too short');

  switch (q.type) {
    case 'mcq': {
      const n = q.options?.length ?? 0;
      if (n < 3 || n > 5) errs.push('mcq needs 3-5 options');
      if (!(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < n)) errs.push('mcq correct_index out of range');
      break;
    }
    case 'multi': {
      const n = q.options?.length ?? 0;
      const c = q.correct_indices ?? [];
      if (n < 4 || n > 6) errs.push('multi needs 4-6 options');
      if (!c.length) errs.push('multi needs at least one correct option');
      if (c.length >= n) errs.push('multi cannot have every option correct');
      if (c.some(i => i < 0 || i >= n)) errs.push('multi correct_indices out of range');
      if (new Set(c).size !== c.length) errs.push('multi correct_indices has duplicates');
      break;
    }
    case 'cloze': {
      const b = q.blanks ?? [];
      if (b.length < 1 || b.length > 2) errs.push('cloze needs 1-2 blanks');
      b.forEach((x, i) => { if (!x.accept?.length) errs.push(`cloze blank ${i} has no accepted answers`); });
      break;
    }
    case 'spot_error': {
      const n = q.lines?.length ?? 0;
      if (n < 3) errs.push('spot_error needs at least 3 lines');
      if (!(Number.isInteger(q.bad_line) && q.bad_line >= 0 && q.bad_line < n)) errs.push('spot_error bad_line out of range');
      if (!q.why?.trim()) errs.push('spot_error needs a why');
      break;
    }
    case 'predict_output':
      if (!q.accept?.length) errs.push('predict_output needs accepted answers');
      if (!q.explain?.trim()) errs.push('predict_output needs an explain');
      break;
    case 'ordering': {
      const n = q.items?.length ?? 0;
      if (n < 3 || n > 6) errs.push('ordering needs 3-6 items');
      if (!isPermutation(q.correct_order, n)) errs.push('ordering correct_order is not a permutation');
      break;
    }
    case 'matching': {
      const n = q.left?.length ?? 0;
      if (n < 3 || n > 5) errs.push('matching needs 3-5 left items');
      if ((q.right?.length ?? 0) !== n) errs.push('matching left and right must be the same length');
      const pairs = q.pairs ?? [];
      if (pairs.length !== n) errs.push('matching needs one pair per left item');
      if (!isPermutation(pairs.map(p => p?.[1]), n)) errs.push('matching pairs must map each right item exactly once');
      if (!isPermutation(pairs.map(p => p?.[0]), n)) errs.push('matching pairs must cover each left item exactly once');
      break;
    }
    case 'tf_why':
      if (typeof q.verdict !== 'boolean') errs.push('tf_why needs a boolean verdict');
      checkCriteria(q, errs);
      break;
    default:
      if (!isFree(q.type)) errs.push(`unhandled type ${q.type}`);
      else checkCriteria(q, errs);
  }
  return errs;
}

// ---------------------------------------------------------------- duplicates

/**
 * A question you have seen before teaches nothing and wastes a slot in a
 * four-question night, so near-duplicates are rejected rather than merely
 * flagged. Matching is on the prompt: the same idea reworded is still the same
 * rep.
 */
export const normalizePrompt = s => String(s)
  .toLowerCase()
  .replace(/[`"'’“”]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const trigrams = s => {
  const t = ` ${s} `;
  const out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
};

/** Dice coefficient over character trigrams: 1 is identical, 0 shares nothing. */
export function similarity(a, b) {
  const A = trigrams(normalizePrompt(a));
  const B = trigrams(normalizePrompt(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Above this, two prompts are the same question wearing different clothes. */
export const DUPLICATE_THRESHOLD = 0.72;

/**
 * Returns the existing question this one duplicates, or null.
 * An exact normalized match counts anywhere in the bank; a near match counts
 * within the same concept, where two prompts compete for the same slot.
 */
export function findDuplicate(draft, existing, threshold = DUPLICATE_THRESHOLD) {
  const norm = normalizePrompt(draft.prompt ?? '');
  if (!norm) return null;

  for (const q of existing) {
    if (normalizePrompt(q.prompt) === norm) return { of: q, score: 1, reason: 'identical prompt' };
  }
  for (const q of existing) {
    if (q.concept_id !== draft.concept_id) continue;
    const score = similarity(draft.prompt, q.prompt);
    if (score >= threshold) return { of: q, score: Number(score.toFixed(3)), reason: 'near-identical prompt' };
  }
  return null;
}

/** Normalize a validated draft into the committed row shape (SPEC.md §5). */
export function toRow(q, id) {
  const row = {
    id,
    concept_id: q.concept_id,
    type: q.type,
    prompt: q.prompt.trim(),
    scope: q.scope === 'work' ? 'work' : 'curriculum',
    origin_capture_id: q.origin_capture_id ?? null,
  };
  switch (q.type) {
    case 'mcq': row.answer = { options: q.options, correct: q.correct_index }; break;
    case 'multi': row.answer = { options: q.options, correct: [...q.correct_indices].sort((a, b) => a - b) }; break;
    case 'cloze': row.answer = { blanks: q.blanks }; break;
    case 'spot_error': row.answer = { lines: q.lines, bad_line: q.bad_line, why: q.why.trim() }; break;
    case 'predict_output': row.answer = { accept: q.accept, explain: q.explain.trim() }; break;
    case 'ordering': row.answer = { items: q.items, correct_order: q.correct_order }; break;
    case 'matching': row.answer = { left: q.left, right: q.right, pairs: q.pairs }; break;
    case 'tf_why':
      row.answer = { correct: q.verdict, rubric: { criteria: q.criteria } };
      row.rubric = { criteria: q.criteria };
      break;
    default: row.rubric = { criteria: q.criteria };
  }
  row.rubric_version = RUBRIC_VERSION;
  row.created_at = today();
  return row;
}
