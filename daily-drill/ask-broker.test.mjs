/**
 * ask-broker is the nightly's only route to a model. The failures it exists
 * to make loud: a refused call (budget, policy) logged as just "failed", and a
 * reply with prose around the JSON that leaves the draft unparseable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { extractArray, explainRefusal, askBroker, replyToWrite } from './ask-broker.mjs';

const SCRIPT = fileURLToPath(new URL('./ask-broker.mjs', import.meta.url));

/** A stand-in broker on a free port. `answer(body)` returns [status, json]. */
async function fakeBroker(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ path: req.url, body });
      const [status, json] = answer(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, seen, close: () => new Promise((r) => server.close(r)) };
}

test('finds the array however the reply wraps it', () => {
  assert.deepEqual(extractArray('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(extractArray('Here you go:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractArray('Sure. [1, 2] Done.'), [1, 2]);
  assert.equal(extractArray('{"not": "an array"}'), null);
  assert.equal(extractArray('no json at all'), null);
});

test('a refusal names the broker code', () => {
  const line = explainRefusal(429, JSON.stringify({ error: 'budget_exceeded', detail: 'recall has spent $15' }));
  assert.equal(line, 'broker 429 budget_exceeded: recall has spent $15');
  assert.match(explainRefusal(502, '<html>bad gateway</html>'), /^broker 502: <html>/);
});

test('sends the recall app id, the prompt and the schema; never a model or a user', async () => {
  const b = await fakeBroker(() => [200, { text: 'ok', path: 'api', model: 'claude-opus-5-5' }]);
  try {
    const reply = await askBroker({ app_id: 'recall', prompt: 'p', max_tokens: 10, schema: { type: 'object' } }, { url: b.url });
    assert.equal(reply.text, 'ok');
    assert.equal(b.seen[0].path, '/v1/ask');
    assert.equal(b.seen[0].body.app_id, 'recall');
    assert.ok(!('model' in b.seen[0].body) && !('user' in b.seen[0].body));
  } finally {
    await b.close();
  }
});

test('a refused call rejects with the reason, not a bare status', async () => {
  const b = await fakeBroker(() => [403, { error: 'ai_disabled', detail: "'recall' has ai = \"none\"" }]);
  try {
    await assert.rejects(askBroker({ app_id: 'recall', prompt: 'p' }, { url: b.url }),
      /broker 403 ai_disabled/);
  } finally {
    await b.close();
  }
});

test('an unreachable broker says so', async () => {
  await assert.rejects(askBroker({ app_id: 'recall', prompt: 'p' }, { url: 'http://127.0.0.1:1', timeoutMs: 2000 }),
    /broker unreachable/);
});

test('what gets written: the array alone, the data, or the text', () => {
  assert.equal(replyToWrite({ text: 'x [1] y' }, { array: true }), '[\n  1\n]\n');
  assert.throws(() => replyToWrite({ text: 'sorry' }, { array: true }), /no JSON array in the reply; it began: sorry/);
  assert.equal(replyToWrite({ data: { verdicts: [] } }, { schema: {} }), '{\n  "verdicts": []\n}\n');
  assert.throws(() => replyToWrite({ text: 'x' }, { schema: {} }), /no structured answer/);
  assert.equal(replyToWrite({ text: 'plain' }), 'plain');
});

function run(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the CLI writes the draft on success and one reason line on failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ask-broker-'));
  let fail = false;
  const b = await fakeBroker((body) => fail
    ? [429, { error: 'budget_exceeded', detail: 'over' }]
    : [200, { text: `Here:\n[{"prompt":"${body.max_tokens}"}]`, path: 'api', model: 'claude-opus-5-5', cost_usd: 0.25 }]);
  try {
    writeFileSync(join(dir, 'prompt.txt'), 'write questions');
    const ok = await run([join(dir, 'prompt.txt'), join(dir, 'draft.json'), '--array', '--max-tokens', '64000'],
      { DRILL_BROKER_URL: b.url });
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8')), [{ prompt: '64000' }]);
    assert.match(ok.stdout, /claude-opus-5-5 via api, \$0\.2500/);

    fail = true;
    const bad = await run([join(dir, 'prompt.txt'), join(dir, 'other.json'), '--array'], { DRILL_BROKER_URL: b.url });
    assert.equal(bad.code, 1);
    assert.equal(bad.stderr.trim(), 'broker 429 budget_exceeded: over');
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
