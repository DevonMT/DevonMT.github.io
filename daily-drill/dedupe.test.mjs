/**
 * Tests for duplicate detection (the gate that stops the nightly routine
 * re-asking questions the bank already contains).
 *
 *   node --test daily-drill/dedupe.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrompt, similarity, findDuplicate, DUPLICATE_THRESHOLD } from './bank-schema.mjs';

const q = (id, concept_id, prompt) => ({ id, concept_id, prompt });

test('normalizePrompt ignores case, punctuation and spacing', () => {
  assert.equal(
    normalizePrompt('Explain what an INDEX is — really!'),
    normalizePrompt('explain what an index is really'),
  );
  assert.equal(normalizePrompt('`SELECT *`  vs   "SELECT *"'), 'select vs select');
});

test('similarity is 1 for identical text and low for unrelated text', () => {
  assert.equal(similarity('the same sentence', 'the same sentence'), 1);
  assert.ok(similarity('explain what an index is', 'name the three fact table types') < 0.3);
});

test('an identical prompt is caught even under a different concept', () => {
  const existing = [q('q1', 'sql.join_types', 'Explain what a left join keeps.')];
  const dupe = findDuplicate({ concept_id: 'modeling.star_schema', prompt: 'explain what a LEFT JOIN keeps' }, existing);
  assert.ok(dupe, 'exact matches are global — the same prompt is the same rep');
  assert.equal(dupe.reason, 'identical prompt');
  assert.equal(dupe.of.id, 'q1');
});

test('a reworded question on the same concept is caught', () => {
  const existing = [q('q1', 'sql.join_fanout',
    'You join orders to order_items and the total revenue in your report doubles. Explain what happened.')];
  const dupe = findDuplicate({
    concept_id: 'sql.join_fanout',
    prompt: 'You join orders to order_items and the total revenue in your report doubles. Explain what happened here.',
  }, existing);
  assert.ok(dupe, 'a trailing word does not make it a new question');
  assert.ok(dupe.score >= DUPLICATE_THRESHOLD);
});

test('a genuinely different question on the same concept passes', () => {
  const existing = [q('q1', 'sql.join_fanout',
    'You join orders to order_items and the total revenue in your report doubles. Explain what happened.')];
  const fresh = {
    concept_id: 'sql.join_fanout',
    prompt: 'Which check most directly tells you whether a join has multiplied rows?',
  };
  assert.equal(findDuplicate(fresh, existing), null);
});

test('near-duplicate matching is scoped to the concept', () => {
  // the same phrasing about a different concept is a legitimate parallel question
  const existing = [q('q1', 'sql.join_types', 'When would you deliberately not use a LEFT JOIN here?')];
  const other = { concept_id: 'perf.index_basics', prompt: 'When would you deliberately not use an index here?' };
  assert.equal(findDuplicate(other, existing), null);
});

test('an empty prompt is never treated as a duplicate', () => {
  assert.equal(findDuplicate({ concept_id: 'a', prompt: '' }, [q('q1', 'a', 'something')]), null);
});

test('the real bank contains no duplicates', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const rows = [];
  for (const d of ['data', 'software', 'build', 'ops', 'comms']) {
    const p = new URL(`../daily-drill/app/bank/${d}.json`, import.meta.url);
    if (existsSync(p)) rows.push(...JSON.parse(readFileSync(p, 'utf8')));
  }
  const collisions = [];
  for (let i = 0; i < rows.length; i++) {
    const dupe = findDuplicate(rows[i], rows.slice(0, i));
    if (dupe) collisions.push(`${rows[i].id} ~ ${dupe.of.id} (${dupe.score})`);
  }
  assert.deepEqual(collisions, [], `duplicates found: ${collisions.join(', ')}`);
});
