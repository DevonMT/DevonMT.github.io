/**
 * Daily Drill - cross-device sync (SPEC.md §2, phase 2).
 *
 * Local state stays authoritative. Sync is a merge in both directions, never a
 * download that replaces you: the attempt log is a grow-only set, so pulling
 * cannot delete a session and pushing cannot delete one done elsewhere.
 *
 * Nothing here is allowed to block a drill. Every call has a timeout and every
 * failure is survivable - offline, the app behaves exactly as it did before
 * sync existed.
 */

import { mergeState, syncPayload } from './store.js';

/** Shared with the other private apps, so one key unlocks a device once. */
export const KEY_NAME = 'devon_key';
const ENDPOINT_NAME = 'daily-drill/sync-endpoint';

/** Boot must not stall behind a slow network; a normal pull is ~200ms. */
const PULL_TIMEOUT_MS = 2500;
const PUSH_TIMEOUT_MS = 8000;

export const getKey = () => {
  try { return localStorage.getItem(KEY_NAME); } catch { return null; }
};
export const setKey = key => {
  try { localStorage.setItem(KEY_NAME, key); } catch { /* private mode */ }
};

/**
 * The Worker URL. Configurable at runtime so the endpoint is not baked into a
 * committed file, and so a local Worker can be pointed at during development.
 */
export function getEndpoint() {
  try { return localStorage.getItem(ENDPOINT_NAME) || window.DRILL_SYNC_URL || null; } catch { return null; }
}
export function setEndpoint(url) {
  try { localStorage.setItem(ENDPOINT_NAME, url.replace(/\/+$/, '')); } catch { /* private mode */ }
}

export const syncConfigured = () => Boolean(getKey() && getEndpoint());

async function call(path, { method = 'GET', body, timeout = PULL_TIMEOUT_MS } = {}) {
  const endpoint = getEndpoint();
  const key = getKey();
  if (!endpoint || !key) throw Object.assign(new Error('sync not configured'), { code: 'unconfigured' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method,
      signal: controller.signal,
      headers: { 'x-api-secret': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw Object.assign(new Error('access key rejected'), { code: 'unauthorized' });
    if (!res.ok) throw Object.assign(new Error(`sync failed (${res.status})`), { code: 'http' });
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Validate a key before storing it. Used by the gate. */
export async function checkKey(endpoint, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
      headers: { 'x-api-secret': key },
    });
    if (res.status === 401) return { ok: false, reason: 'That key was rejected.' };
    if (!res.ok) return { ok: false, reason: `Sync service error (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Could not reach the sync service.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merge the remote log into local. Returns the state to use plus how many
 * attempts were new, so the caller can tell whether anything actually changed.
 */
export async function pull(state) {
  const remote = await call('/state');
  const merged = mergeState(state, { ...remote, settings: state.settings });
  return { state: merged, gained: merged.attempts.length - state.attempts.length };
}

/**
 * Push local work up. The Worker merges rather than replaces, so this is safe
 * to repeat and safe to run from two devices at once.
 */
export async function push(state) {
  const merged = await call('/state', { method: 'POST', body: syncPayload(state), timeout: PUSH_TIMEOUT_MS });
  return { state: mergeState(state, { ...merged, settings: state.settings }) };
}

/**
 * Pull, then push, then hand back the reconciled state. Used on boot and after
 * a session. Never throws: a sync failure must not interrupt a drill, so the
 * caller gets its own state back with a reason.
 */
export async function reconcile(state) {
  if (!syncConfigured()) return { state, ok: false, reason: 'unconfigured' };
  try {
    const pulled = await pull(state);
    const pushed = await push(pulled.state);
    return { state: pushed.state, ok: true, gained: pulled.gained };
  } catch (err) {
    return { state, ok: false, reason: err.code ?? 'error', message: err.message };
  }
}
