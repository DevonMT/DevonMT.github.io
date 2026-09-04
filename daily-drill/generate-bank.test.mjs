/**
 * Tests for the bank generator's validator and row normalizer.
 * No network - these run against fixtures.
 *
 *   node --test daily-drill/generate-bank.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, toRow, nextId } from './bank-schema.mjs';

const IDS = new Set(['sql.join_fanout']);
const base = { concept_id: 'sql.join_fanout', prompt: 'A prompt long enough to pass the length floor.' };
const ok = q => assert.deepEqual(validate({ ...base, ...q }, IDS), []);
const fails = (q, match) => {
  const errs = validate({ ...base, ...q }, IDS);
  assert.ok(errs.length > 0, 'expected at least one error');
  if (match) assert.ok(errs.some(e => e.includes(match)), `expected an error containing "${match}", got: ${errs.join(' | ')}`);
};

const GOOD_CRITERIA = [
  'States that the join key is not unique on the right side',
  'Names the inflated SUM as the observable symptom',
  'Gives a way to detect it before trusting the number',
];

test('rejects a concept id outside the batch', () => {
  fails({ type: 'explain', concept_id: 'sql.other', criteria: GOOD_CRITERIA }, 'not in this batch');
});

test('rejects a stub prompt', () => {
  fails({ type: 'explain', prompt: 'Explain.', criteria: GOOD_CRITERIA }, 'prompt too short');
});

test('mcq: accepts a well-formed question, rejects a bad index', () => {
  ok({ type: 'mcq', options: ['a', 'b', 'c'], correct_index: 2 });
  fails({ type: 'mcq', options: ['a', 'b', 'c'], correct_index: 3 }, 'out of range');
  fails({ type: 'mcq', options: ['a', 'b'], correct_index: 0 }, '3-5 options');
});

test('multi: rejects "every option correct" and duplicates', () => {
  ok({ type: 'multi', options: ['a', 'b', 'c', 'd'], correct_indices: [0, 3] });
  fails({ type: 'multi', options: ['a', 'b', 'c', 'd'], correct_indices: [0, 1, 2, 3] }, 'every option correct');
  fails({ type: 'multi', options: ['a', 'b', 'c', 'd'], correct_indices: [1, 1] }, 'duplicates');
  fails({ type: 'multi', options: ['a', 'b', 'c', 'd'], correct_indices: [] }, 'at least one correct');
});

test('cloze: every blank needs accepted answers', () => {
  ok({ type: 'cloze', blanks: [{ accept: ['ROWS', 'rows'] }] });
  fails({ type: 'cloze', blanks: [{ accept: [] }] }, 'no accepted answers');
  fails({ type: 'cloze', blanks: [] }, '1-2 blanks');
});

test('spot_error: bad_line must index a real line', () => {
  ok({ type: 'spot_error', lines: ['a', 'b', 'c'], bad_line: 1, why: 'joins on a non-unique key' });
  fails({ type: 'spot_error', lines: ['a', 'b', 'c'], bad_line: 3, why: 'x' }, 'bad_line out of range');
  fails({ type: 'spot_error', lines: ['a', 'b', 'c'], bad_line: 1, why: '  ' }, 'needs a why');
});

test('ordering: correct_order must be a permutation', () => {
  ok({ type: 'ordering', items: ['a', 'b', 'c'], correct_order: [2, 0, 1] });
  fails({ type: 'ordering', items: ['a', 'b', 'c'], correct_order: [0, 0, 1] }, 'not a permutation');
  fails({ type: 'ordering', items: ['a', 'b', 'c'], correct_order: [0, 1] }, 'not a permutation');
});

test('matching: each side used exactly once', () => {
  ok({ type: 'matching', left: ['a', 'b', 'c'], right: ['x', 'y', 'z'], pairs: [[0, 2], [1, 0], [2, 1]] });
  fails({ type: 'matching', left: ['a', 'b', 'c'], right: ['x', 'y', 'z'], pairs: [[0, 1], [1, 1], [2, 2]] }, 'each right item exactly once');
  fails({ type: 'matching', left: ['a', 'b', 'c'], right: ['x', 'y'], pairs: [[0, 0]] }, 'same length');
});

test('tf_why needs both a verdict and a rubric', () => {
  ok({ type: 'tf_why', verdict: true, criteria: GOOD_CRITERIA });
  fails({ type: 'tf_why', criteria: GOOD_CRITERIA }, 'boolean verdict');
  fails({ type: 'tf_why', verdict: true, criteria: ['too short'] }, '3-5 criteria');
});

test('free-text rubrics must be checkable, not vague', () => {
  for (const type of ['explain', 'critique', 'when_not', 'breaks_first', 'to_stakeholder', 'push_back', 'estimate']) {
    ok({ type, criteria: GOOD_CRITERIA });
  }
  fails({ type: 'explain', criteria: ['Explains the concept well and in depth', ...GOOD_CRITERIA.slice(1)] }, 'is vague');
  fails({ type: 'explain', criteria: ['Demonstrates understanding of joins', ...GOOD_CRITERIA.slice(1)] }, 'is vague');
  fails({ type: 'explain', criteria: ['Says it', ...GOOD_CRITERIA.slice(1)] }, 'too short to check');
  fails({ type: 'explain', criteria: GOOD_CRITERIA.slice(0, 2) }, '3-5 criteria');
});

test('toRow shapes static answers per SPEC.md §5', () => {
  const mcq = toRow({ ...base, type: 'mcq', options: ['a', 'b', 'c'], correct_index: 2 }, 'q_1');
  assert.deepEqual(mcq.answer, { options: ['a', 'b', 'c'], correct: 2 });
  assert.equal(mcq.rubric, undefined);

  const multi = toRow({ ...base, type: 'multi', options: ['a', 'b', 'c', 'd'], correct_indices: [3, 0] }, 'q_2');
  assert.deepEqual(multi.answer.correct, [0, 3], 'correct indices are sorted');

  const free = toRow({ ...base, type: 'explain', criteria: GOOD_CRITERIA }, 'q_3');
  assert.deepEqual(free.rubric, { criteria: GOOD_CRITERIA });
  assert.equal(free.answer, undefined);

  // §5: tf_why carries both an answer block and a rubric
  const tf = toRow({ ...base, type: 'tf_why', verdict: false, criteria: GOOD_CRITERIA }, 'q_4');
  assert.equal(tf.answer.correct, false);
  assert.deepEqual(tf.answer.rubric.criteria, GOOD_CRITERIA);
  assert.deepEqual(tf.rubric.criteria, GOOD_CRITERIA);
});

test('every row carries scope, rubric_version and created_at', () => {
  const row = toRow({ ...base, type: 'explain', criteria: GOOD_CRITERIA }, 'q_5');
  assert.equal(row.scope, 'curriculum');
  assert.equal(row.origin_capture_id, null);
  assert.equal(row.rubric_version, 1);
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('nextId is stable and never collides', () => {
  const taken = new Set();
  const a = nextId('sql.window.frame_clause', 'explain', taken);
  assert.equal(a, 'q_sql_window_frame_clause_explain_001');
  taken.add(a);
  assert.equal(nextId('sql.window.frame_clause', 'explain', taken), 'q_sql_window_frame_clause_explain_002');
});
