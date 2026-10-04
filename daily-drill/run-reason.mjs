/**
 * Daily Drill - say WHY a claude run failed.
 *
 * nightly.sh used to log "FAILED: claude run failed" and nothing more. The
 * reason was in /tmp/drill-run.json, which the next night overwrote, so a
 * week-long failure (a quoting bug) could only be diagnosed while it was
 * still happening. This turns that file into one line for ~/logs/daily-drill.log.
 *
 *   node daily-drill/run-reason.mjs <output-file>
 *
 * `claude -p --output-format json` prints an object with `is_error` and
 * `result` (newer versions with `subtype` and `errors`), or an array of
 * stream events ending in such an object. Text-format output and a crash
 * before any output are handled too: the reason is whatever is there, never
 * nothing. Always exits 0 - it runs inside a failure path and must not mask
 * the real exit.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX = 600;

function oneLine(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > MAX ? t.slice(0, MAX) + '...' : t;
}

function fromObject(o) {
  if (!o || typeof o !== 'object') return '';
  const parts = [];
  if (o.subtype && o.subtype !== 'success') parts.push(String(o.subtype));
  if (typeof o.result === 'string' && o.result.trim()) parts.push(o.result);
  if (Array.isArray(o.errors) && o.errors.length) parts.push(o.errors.map(String).join('; '));
  if (typeof o.error === 'string' && o.error.trim()) parts.push(o.error);
  else if (o.error && typeof o.error.message === 'string') parts.push(o.error.message);
  return parts.join(': ');
}

/** The one-line reason a run failed, from its captured stdout. */
export function explainRun(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 'no output captured';
  let parsed;
  try { parsed = JSON.parse(text); } catch { return oneLine(text.split('\n').slice(-5).join(' ')); }
  const events = Array.isArray(parsed) ? [...parsed].reverse() : [parsed];
  for (const e of events) {
    const r = fromObject(e);
    if (r) return oneLine(r);
  }
  return 'no error text in output: ' + oneLine(text.slice(0, 200));
}

const isMain = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

if (isMain) {
  let raw = '';
  try { raw = readFileSync(process.argv[2], 'utf8'); } catch { /* missing file: explainRun reports it */ }
  process.stdout.write(explainRun(raw) + '\n');
}
