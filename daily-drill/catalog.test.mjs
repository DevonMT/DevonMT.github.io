/**
 * The catalog fingerprint has to be sensitive to exactly one thing: which
 * concepts exist. If it moves for any other reason it becomes noise, and a
 * version people learn to ignore is no better than the hand-typed date it
 * replaced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { catalogFingerprint } from './app/js/catalog.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const base = [
  { id: 'sql.window.frame_clause', tier: 2, prereqs: ['sql.window.basics'] },
  { id: 'sql.window.basics', tier: 1, prereqs: [] },
  { id: 'ops.backup.restore_test', tier: 2, prereqs: [] },
];

test('same concepts, any order, same fingerprint', () => {
  const shuffled = [base[2], base[0], base[1]];
  assert.equal(catalogFingerprint(base), catalogFingerprint(shuffled));
});

test('tier and prerequisite edits do not move it', () => {
  const edited = base.map(c => ({ ...c, tier: c.tier + 1, prereqs: ['anything'] }));
  assert.equal(catalogFingerprint(base), catalogFingerprint(edited));
});

test('adding a concept moves it', () => {
  const grown = [...base, { id: 'data.modelling.scd2', tier: 2, prereqs: [] }];
  assert.notEqual(catalogFingerprint(base), catalogFingerprint(grown));
});

test('removing a concept moves it', () => {
  assert.notEqual(catalogFingerprint(base), catalogFingerprint(base.slice(1)));
});

test('renaming a concept moves it', () => {
  const renamed = base.map((c, i) => (i === 0 ? { ...c, id: 'sql.window.frames' } : c));
  assert.notEqual(catalogFingerprint(base), catalogFingerprint(renamed));
});

test('the count is readable in the value', () => {
  assert.match(catalogFingerprint(base), /^3c-[0-9a-f]{8}$/);
});

test('an empty or malformed catalog does not throw', () => {
  assert.equal(catalogFingerprint([]), catalogFingerprint([]));
  assert.match(catalogFingerprint([]), /^0c-[0-9a-f]{8}$/);
  assert.match(catalogFingerprint(null), /^0c-[0-9a-f]{8}$/);
  assert.match(catalogFingerprint([{ tier: 1 }]), /^1c-[0-9a-f]{8}$/);
});

test('the real catalog produces a stable value', () => {
  const rows = JSON.parse(
    readFileSync(join(HERE, 'app/catalog/concepts.json'), 'utf8'));
  const first = catalogFingerprint(rows);
  // Reformatting the file must not change it: parse-and-reserialise, reorder,
  // and confirm the value survives both.
  const round = JSON.parse(JSON.stringify([...rows].reverse()));
  assert.equal(catalogFingerprint(round), first);
  assert.match(first, new RegExp(`^${rows.length}c-[0-9a-f]{8}$`));
});
