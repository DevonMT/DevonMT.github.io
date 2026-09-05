/**
 * Sync round-trip tests: client against a stand-in for the Worker that uses the
 * Worker's own merge rule.
 *
 *   node --test daily-drill/sync.test.mjs
 *
 * The property under test is the one the whole design rests on: syncing must
 * never delete work, in either direction, however many times it runs.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAttempts } from '../daily-drill/app/js/srs.js';

// --- a minimal localStorage + fetch, so the browser modules load under node ---

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.window = globalThis;

/** Stands in for the platform, applying the same union rule it applies. */
const server = { attempts: [], session_dates: [] };
/** Whether the caller is signed in. The real server decides this from a cookie. */
let signedIn = true;
let noAccess = false;
let lastCredentials = null;
let failNext = null;

globalThis.fetch = async (url, init = {}) => {
  // The session cookie only travels if the request asks for it, so this is the
  // single most important thing to assert about every call.
  lastCredentials = init.credentials ?? null;
  if (failNext) { const f = failNext; failNext = null; throw new Error(f); }
  if (!signedIn) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 });
  if (noAccess) return new Response(JSON.stringify({ error: 'no access' }), { status: 403 });

  const path = new URL(url).pathname;
  if (path === '/health') return new Response(JSON.stringify({ ok: true }), { status: 200 });
  if (path === '/state' && (init.method ?? 'GET') === 'GET') {
    return new Response(JSON.stringify(server), { status: 200 });
  }
  if (path === '/state') {
    const incoming = JSON.parse(init.body);
    server.attempts = mergeAttempts(server.attempts, incoming.attempts);
    server.session_dates = [...new Set([...server.session_dates, ...(incoming.session_dates ?? [])])].sort();
    return new Response(JSON.stringify(server), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
};

const sync = await import('../daily-drill/app/js/sync.js');
const { emptyState } = await import('../daily-drill/app/js/store.js');

const attempt = (id, concept_id, created_at, extra = {}) => ({
  id, concept_id, question_id: `${concept_id}_q`, score: 1, created_at,
  counted_toward_srs: true, scope: 'curriculum', ...extra,
});
const device = attempts => ({ ...emptyState(), attempts, session_dates: [created(attempts)] });
const created = a => (a[0]?.created_at ?? '2026-09-01T00:00:00Z').slice(0, 10);

beforeEach(() => {
  store.clear();
  server.attempts = [];
  server.session_dates = [];
  failNext = null;
  signedIn = true;
  noAccess = false;
  lastCredentials = null;
  sync.setEndpoint('https://sync.example.com');
  sync.enableSync();
});

test('sync is off until this device opts in', () => {
  store.clear();
  assert.equal(sync.syncConfigured(), false, 'a fresh device does not sync');
  sync.enableSync();
  assert.equal(sync.syncConfigured(), true);
  sync.disableSync();
  assert.equal(sync.syncConfigured(), false, 'and it can be turned back off');
});

test('every call carries the session cookie', async () => {
  await sync.reconcile(device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]));
  assert.equal(lastCredentials, 'include',
    'without credentials the cookie is not sent and every call is a 401');
});

test('checkSession passes when signed in and explains itself when not', async () => {
  assert.deepEqual(await sync.checkSession('https://sync.example.com'), { ok: true });

  signedIn = false;
  const out = await sync.checkSession('https://sync.example.com');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'signin');

  // Signed in but ungranted is a different problem with a different fix, and
  // collapsing the two sends people to the wrong place.
  signedIn = true; noAccess = true;
  const denied = await sync.checkSession('https://sync.example.com');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'noaccess');
});

test('a trailing slash on the endpoint does not produce a double slash', async () => {
  sync.setEndpoint('https://sync.example.com/');
  assert.equal(sync.getEndpoint(), 'https://sync.example.com');
  const res = await sync.reconcile(device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]));
  assert.equal(res.ok, true);
});

test('two devices converge without either losing a session', async () => {
  const phone = device([attempt('p1', 'sql.join_types', '2026-09-02T08:00:00Z')]);
  const laptop = device([attempt('l1', 'perf.index_basics', '2026-09-02T22:00:00Z')]);

  const afterPhone = await sync.reconcile(phone);
  const afterLaptop = await sync.reconcile(laptop);
  const phoneAgain = await sync.reconcile(afterPhone.state);

  const ids = s => s.attempts.map(a => a.id).sort();
  assert.deepEqual(ids(afterLaptop.state), ['l1', 'p1'], 'laptop gained the phone session');
  assert.deepEqual(ids(phoneAgain.state), ['l1', 'p1'], 'phone gained the laptop session');
  assert.deepEqual(ids(server), ['l1', 'p1']);
});

test('reconcile is idempotent', async () => {
  const d = device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]);
  const once = await sync.reconcile(d);
  const twice = await sync.reconcile(once.state);
  assert.deepEqual(once.state.attempts, twice.state.attempts);
  assert.equal(server.attempts.length, 1);
});

test('a device offline for a month does not wipe the server when it returns', async () => {
  // others have been drilling while this one was away
  server.attempts = [
    attempt('s1', 'a', '2026-08-01T20:00:00Z'),
    attempt('s2', 'b', '2026-08-15T20:00:00Z'),
  ];
  const stale = device([attempt('old', 'c', '2026-07-01T20:00:00Z')]);

  const res = await sync.reconcile(stale);
  assert.equal(res.ok, true);
  assert.equal(server.attempts.length, 3, 'the server kept everything it had');
  assert.equal(res.state.attempts.length, 3, 'and the returning device caught up');
});

test('work-scoped attempts never leave the device', async () => {
  const d = device([
    attempt('pub', 'sql.join_types', '2026-09-01T20:00:00Z'),
    attempt('priv', 'internal.thing', '2026-09-01T21:00:00Z', { scope: 'work' }),
  ]);
  await sync.reconcile(d);
  assert.deepEqual(server.attempts.map(a => a.id), ['pub'], 'the work-lane rep stayed local');
});

test('being signed out reports it without touching local state', async () => {
  signedIn = false;
  const d = device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]);
  const res = await sync.reconcile(d);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'signin');
  assert.deepEqual(res.state.attempts.map(a => a.id), ['a1'], 'local work is returned untouched');
});

test('having no grant reports it without touching local state', async () => {
  noAccess = true;
  const d = device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]);
  const res = await sync.reconcile(d);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'noaccess');
  assert.deepEqual(res.state.attempts.map(a => a.id), ['a1'], 'local work is returned untouched');
});

test('being offline is survivable and never throws', async () => {
  failNext = 'network down';
  const d = device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]);
  const res = await sync.reconcile(d);
  assert.equal(res.ok, false);
  assert.deepEqual(res.state.attempts.map(a => a.id), ['a1']);
});

test('reconcile on an unconfigured device is a quiet no-op', async () => {
  store.clear();
  const d = device([attempt('a1', 'sql.join_types', '2026-09-01T20:00:00Z')]);
  const res = await sync.reconcile(d);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unconfigured');
  assert.equal(res.state.attempts.length, 1);
});

test('local device settings are never overwritten by the server', async () => {
  const d = { ...device([attempt('a1', 'a', '2026-09-01T20:00:00Z')]), settings: { show_work_lane: false } };
  const res = await sync.reconcile(d);
  assert.equal(res.state.settings.show_work_lane, false);
});
