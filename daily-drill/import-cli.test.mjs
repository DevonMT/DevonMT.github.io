/**
 * The importer's exit-code contract, which the nightly cron job depends on.
 *
 *   node --test daily-drill/import-cli.test.mjs
 *
 * All runs here are --dry-run, so the committed bank is never touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./import-drafts.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'drill-'));

const CRITERIA = [
  'States that PUT is defined by being idempotent, not by updating',
  'Says a PUT can create a resource when the client chooses the identifier',
  'Names the consequence: a retried POST can create a second resource',
];
// deliberately unrelated wording: near-identical fixtures would (correctly) be
// caught by duplicate detection and defeat the point of the test
const PROMPTS = [
  'Why does offset pagination silently skip rows when the underlying data changes between pages?',
  'A client asks for every record in one response rather than paging. What do you tell them?',
  'Describe how a cursor identifies a position without relying on a row count.',
  'Under what conditions is offset pagination genuinely the right choice?',
  'Which failure shows up first when a paged export runs against a table receiving inserts?',
];
const good = n => ({
  concept_id: 'api.pagination',
  type: 'explain',
  prompt: PROMPTS[n % PROMPTS.length],
  criteria: CRITERIA,
});
// three criteria so the count check passes, with one too short to be checkable
const bad = {
  concept_id: 'api.pagination',
  type: 'explain',
  prompt: 'Walk through what a client has to store to resume a cursor-paged export after a crash.',
  criteria: ['Says yes', ...CRITERIA.slice(1)],
};

const write = (name, drafts) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(drafts));
  return p;
};

/** returns { code, out } instead of throwing, so exit codes can be asserted */
function run(file, ...flags) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, file, '--dry-run', ...flags], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('a clean batch exits 0', () => {
  const r = run(write('clean.json', [good(1), good(2)]));
  assert.equal(r.code, 0);
  assert.match(r.out, /2 would be accepted/);
});

test('a mixed batch keeps the good drafts and still exits 0', () => {
  // the nightly job must not lose 23 good questions because of 1 bad one
  const r = run(write('mixed.json', [good(3), bad, good(4)]));
  assert.equal(r.code, 0, 'a partial batch is a success');
  assert.match(r.out, /2 would be accepted, 1 rejected/);
  assert.match(r.out, /too short to check/, 'the reject is still reported');
});

test('--strict turns any rejection into a failure', () => {
  const r = run(write('strict.json', [good(0), bad]), '--strict');
  assert.equal(r.code, 1, 'one bad draft fails the whole batch under --strict');
  assert.match(r.out, /too short to check/);
});

test('a batch where nothing is usable exits 1', () => {
  const r = run(write('allbad.json', [bad]));
  assert.equal(r.code, 1, 'cron should treat a wasted run as a failure');
  assert.match(r.out, /0 would be accepted/);
});

test('a draft that duplicates the committed bank is skipped, not imported', () => {
  const dupe = {
    concept_id: 'sql.join_fanout',
    type: 'explain',
    prompt: 'You join orders to order_items and the total revenue in your report doubles. Nothing about the source data changed. Explain what happened and how you would confirm it.',
    criteria: CRITERIA,
  };
  const r = run(write('dupe.json', [dupe]));
  assert.equal(r.code, 1, 'nothing accepted');
  assert.match(r.out, /identical prompt/);
});
