/**
 * The live-vs-repo bank comparison that gates and verifies the nightly deploy.
 *
 *   node --test daily-drill/bank-counts.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoCounts, liveCounts, diff } from './bank-counts.mjs';

const dir = mkdtempSync(join(tmpdir(), 'drill-bank-'));
writeFileSync(join(dir, 'data.json'), JSON.stringify([{}, {}, {}]));
writeFileSync(join(dir, 'ops.json'), JSON.stringify([{}]));
writeFileSync(join(dir, 'notes.txt'), 'ignored');

const serve = bank => async url => {
  const lane = /\/bank\/(\w+)\.json/.exec(url)[1];
  return lane in bank
    ? { ok: true, json: async () => bank[lane] }
    : { ok: false, json: async () => { throw new Error('404'); } };
};

test('repoCounts counts each lane and ignores non-JSON files', () => {
  assert.deepEqual(repoCounts(dir), { data: 3, ops: 1 });
});

test('a live bank equal to the repo reports no difference', async () => {
  const live = await liveCounts('https://x.test/', ['data', 'ops'], serve({ data: [1, 2, 3], ops: [1] }));
  assert.deepEqual(diff(repoCounts(dir), live), []);
});

test('a lagging lane is reported with both counts', async () => {
  const live = await liveCounts('https://x.test', ['data', 'ops'], serve({ data: [1, 2], ops: [1] }));
  assert.deepEqual(diff(repoCounts(dir), live), ['data: repo 3, live 2']);
});

test('an unreadable lane counts as a difference, not a match', async () => {
  const live = await liveCounts('https://x.test', ['data', 'ops'], serve({ data: [1, 2, 3] }));
  assert.deepEqual(diff(repoCounts(dir), live), ['ops: repo 1, live unreadable']);
  const down = await liveCounts('https://x.test', ['data'], async () => { throw new Error('offline'); });
  assert.deepEqual(down, { data: null });
});
