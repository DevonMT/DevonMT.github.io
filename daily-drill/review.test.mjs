/**
 * The review step decides what never reaches the bank, so its failure modes
 * matter more than its happy path.
 *
 * The one it must never repeat: verdicts were first keyed on `id`, which
 * drafts do not have — ids are assigned at import. Every verdict would have
 * matched nothing, every question would have been kept, and the log would have
 * said the batch was reviewed. `matched` exists so that is loud instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractVerdicts, applyVerdicts } from './review-drafts.mjs';

const qs = [
  { concept_id: 'a.b', type: 'explain', prompt: 'good one' },
  { concept_id: 'a.b', type: 'mcq', prompt: 'bad one' },
  { concept_id: 'c.d', type: 'explain', prompt: 'unmentioned one' },
];

test('reads a bare JSON array', () => {
  assert.deepEqual(extractVerdicts('[{"index":0,"verdict":"keep"}]'), [{ index: 0, verdict: 'keep' }]);
});

test('reads it out of a fenced block, which is what the reviewer actually sends', () => {
  const raw = 'Here are my verdicts:\n```json\n[{"index":1,"verdict":"drop","reason":"x"}]\n```\nHope that helps.';
  assert.equal(extractVerdicts(raw)[0].verdict, 'drop');
});

test('reads it out of surrounding prose with no fence', () => {
  const raw = 'I reviewed them. [{"index":1,"verdict":"drop","reason":"no antecedent"}] Done.';
  assert.equal(extractVerdicts(raw)[0].index, 1);
});

test('reads a wrapped object', () => {
  assert.equal(extractVerdicts('{"verdicts":[{"index":0,"verdict":"keep"}]}')[0].index, 0);
});

test('returns null when there is no verdict list at all', () => {
  assert.equal(extractVerdicts('I could not do that.'), null);
  assert.equal(extractVerdicts(''), null);
});

test('drops only what was explicitly rejected', () => {
  const { kept, dropped, matched } = applyVerdicts(qs, [
    { index: 0, verdict: 'keep' },
    { index: 1, verdict: 'drop', reason: 'refers to something it never names' },
  ]);
  assert.deepEqual(kept.map(q => q.prompt), ['good one', 'unmentioned one']);
  assert.deepEqual(dropped.map(d => d.index), [1]);
  assert.equal(matched, 2);
});

test('a question the reviewer never mentioned is kept, not lost', () => {
  const { kept } = applyVerdicts(qs, [{ index: 0, verdict: 'keep' }]);
  assert.equal(kept.length, 3);
});

test('an empty verdict list keeps everything, and reports that nothing was judged', () => {
  const { kept, dropped, matched } = applyVerdicts(qs, []);
  assert.equal(kept.length, 3);
  assert.equal(dropped.length, 0);
  assert.equal(matched, 0);
});

test('verdicts keyed on a field drafts do not have judge nothing', () => {
  // The original bug, pinned: ids do not exist until import.
  const { kept, matched } = applyVerdicts(qs, [
    { id: 'a.b/explain', verdict: 'drop', reason: 'whatever' },
    { id: 'a.b/mcq', verdict: 'drop', reason: 'whatever' },
  ]);
  assert.equal(matched, 0, 'must report that no verdict landed');
  assert.equal(kept.length, 3, 'and must not silently drop on a guess');
});

test('out-of-range and junk entries are ignored', () => {
  const { kept, matched } = applyVerdicts(qs, [
    { index: 99, verdict: 'drop' },
    { index: -1, verdict: 'drop' },
    { index: '1', verdict: 'DROP', reason: 'case and string index both fine' },
    null,
    'nonsense',
  ]);
  assert.equal(matched, 1);
  assert.deepEqual(kept.map(q => q.prompt), ['good one', 'unmentioned one']);
});

test('a drop always carries a reason, even when the reviewer omits one', () => {
  const { dropped } = applyVerdicts(qs, [{ index: 1, verdict: 'drop' }]);
  assert.equal(dropped[0].reason, 'no reason given');
});
