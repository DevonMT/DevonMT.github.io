/**
 * run-reason decides what the nightly log says when claude fails. The failure
 * it exists for: "FAILED: claude run failed" with the cause in a temp file
 * that was gone by morning.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { explainRun } from './run-reason.mjs';

const SCRIPT = fileURLToPath(new URL('./run-reason.mjs', import.meta.url));

test('reports the result text of an error run', () => {
  const raw = JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' });
  assert.equal(explainRun(raw), 'Credit balance is too low');
});

test('includes the subtype and errors list when there is no result', () => {
  const raw = JSON.stringify({ is_error: true, subtype: 'error_max_turns', errors: ['hit limit', 'again'] });
  assert.equal(explainRun(raw), 'error_max_turns: hit limit; again');
});

test('finds the result in an event array, last event first', () => {
  const raw = JSON.stringify([{ type: 'system' }, { type: 'result', is_error: true, result: 'OAuth token expired' }]);
  assert.equal(explainRun(raw), 'OAuth token expired');
});

test('empty or missing output says so rather than logging nothing', () => {
  assert.equal(explainRun(''), 'no output captured');
  assert.equal(explainRun(undefined), 'no output captured');
});

test('non-JSON output (a crash, text format) is logged as its tail on one line', () => {
  assert.equal(explainRun('line1\nTypeError: boom\n'), 'line1 TypeError: boom');
});

test('JSON with no error text still gives a line', () => {
  assert.match(explainRun('{"type":"result"}'), /^no error text in output/);
});

test('long messages are cut to one bounded line', () => {
  const out = explainRun(JSON.stringify({ result: 'x'.repeat(5000) }));
  assert.ok(out.length < 700 && !out.includes('\n'));
});

test('the CLI prints one line and exits 0, even for a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-reason-'));
  try {
    const f = join(dir, 'run.json');
    writeFileSync(f, JSON.stringify({ is_error: true, result: 'bad flag' }));
    const ok = spawnSync(process.execPath, [SCRIPT, f], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, 'bad flag\n');
    const gone = spawnSync(process.execPath, [SCRIPT, join(dir, 'nope')], { encoding: 'utf8' });
    assert.equal(gone.status, 0);
    assert.equal(gone.stdout, 'no output captured\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
