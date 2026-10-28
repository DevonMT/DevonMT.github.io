/**
 * Daily Drill - one model call through the ai-broker on the mini.
 *
 * The nightly used to run `claude -p` on the Claude Max subscription. That
 * login expires without warning, and on 2026-10-03 it did, which stopped the
 * nightly with nobody watching. Calls now go to the broker as the `recall`
 * app, which puts them on the metered API key under Recall's monthly cap and
 * writes an audit line for each. The broker decides the model (Opus 5.5).
 *
 * Claude no longer reads or writes files here: the prompt carries everything
 * it needs, and this script writes the answer. Everything that could corrupt
 * the bank is still done by nightly.sh afterwards, exactly as before.
 *
 *   node daily-drill/ask-broker.mjs <prompt-file> <out-file> [--array] [--schema <file>] [--max-tokens N]
 *
 *   --array   the reply must contain a JSON array; it is written out alone
 *   --schema  ask for this JSON Schema; the broker's parsed `data` is written
 *   neither   the reply text is written as it came
 *
 * On any failure it prints ONE line saying why to stderr and exits 1, so the
 * log says "budget_exceeded" or "broker unreachable" rather than just "failed".
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const BROKER_URL = process.env.DRILL_BROKER_URL ?? 'http://172.30.0.1:8610';
const APP_ID = process.env.DRILL_BROKER_APP ?? 'recall';
// A whole batch on Opus can take minutes, and the broker answers only once it
// has the full reply. fetch() gives up on headers after five, so plain http.
const TIMEOUT_MS = Number(process.env.DRILL_BROKER_TIMEOUT_MS ?? 20 * 60 * 1000);

/** The first JSON array in a reply: bare, fenced, or with a sentence around it. */
export function extractArray(raw) {
  const t = String(raw).trim();
  const attempts = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) attempts.push(fence[1].trim());
  const first = t.indexOf('[');
  const last = t.lastIndexOf(']');
  if (first !== -1 && last > first) attempts.push(t.slice(first, last + 1));
  for (const a of attempts) {
    try {
      const parsed = JSON.parse(a);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* try the next shape */ }
  }
  return null;
}

/** One line for the log from a refused call: the broker's own code first. */
export function explainRefusal(status, rawBody) {
  try {
    const b = JSON.parse(rawBody);
    if (b && (b.error || b.detail)) {
      return `broker ${status} ${b.error ?? ''}: ${String(b.detail ?? '').slice(0, 300)}`.trim();
    }
  } catch { /* not JSON; fall through */ }
  return `broker ${status}: ${String(rawBody).replace(/\s+/g, ' ').slice(0, 300)}`;
}

/** POST one request to /v1/ask. Resolves to the parsed body or rejects with one line. */
export function askBroker(body, { url = BROKER_URL, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(new URL('/v1/ask', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(explainRefusal(res.statusCode, raw)));
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('broker answered 200 with something that is not JSON'));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`broker did not answer within ${timeoutMs / 1000}s`)));
    req.on('error', (err) => reject(new Error(
      err.message.startsWith('broker ') ? err.message : `broker unreachable at ${url}: ${err.message}`)));
    req.end(payload);
  });
}

/** What to write for one reply, or throws with the reason there is nothing usable. */
export function replyToWrite(reply, { array = false, schema = null } = {}) {
  if (schema) {
    if (!reply.data || typeof reply.data !== 'object') throw new Error('broker returned no structured answer');
    return JSON.stringify(reply.data, null, 2) + '\n';
  }
  const text = String(reply.text ?? '');
  if (!array) return text;
  const arr = extractArray(text);
  if (!arr) throw new Error(`no JSON array in the reply; it began: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  return JSON.stringify(arr, null, 2) + '\n';
}

function parseArgs(argv) {
  const out = { positional: [], array: false, schema: null, maxTokens: 16000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--array') out.array = true;
    else if (a === '--schema') out.schema = JSON.parse(readFileSync(argv[++i], 'utf8'));
    else if (a === '--max-tokens') out.maxTokens = Number(argv[++i]);
    else out.positional.push(a);
  }
  return out;
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  const [promptPath, outPath] = args.positional;
  if (!promptPath || !outPath) {
    console.error('usage: ask-broker.mjs <prompt-file> <out-file> [--array] [--schema <file>] [--max-tokens N]');
    process.exit(2);
  }
  const body = { app_id: APP_ID, prompt: readFileSync(promptPath, 'utf8'), max_tokens: args.maxTokens };
  if (args.schema) body.schema = args.schema;
  try {
    const reply = await askBroker(body);
    writeFileSync(outPath, replyToWrite(reply, args));
    console.log(`  ${reply.model ?? 'model'} via ${reply.path ?? 'broker'}, $${Number(reply.cost_usd ?? 0).toFixed(4)}`);
  } catch (err) {
    console.error(String(err.message ?? err).replace(/\s+/g, ' '));
    process.exit(1);
  }
}
