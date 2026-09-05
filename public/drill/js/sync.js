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
 *
 * ---
 *
 * This talks to the devondoes.dev platform, not the old Cloudflare Worker, and
 * carries the platform session cookie instead of a shared key. The practical
 * difference: there is nothing to type on a new device and nothing secret in
 * this file.
 *
 * It only works because the app is served from a *.devondoes.dev host, so the
 * domain-wide session cookie reaches it. Served from anywhere else the browser
 * sends no cookie and every call is a 401 - which is why moving this bundle off
 * drill.devondoes.dev silently breaks sync while the app keeps working.
 */

import { mergeState, syncPayload } from './store.js';

/** The platform's sync API. Overridable for local development only. */
const DEFAULT_ENDPOINT = 'https://id.devondoes.dev/api/drill';
const ENDPOINT_NAME = 'daily-drill/sync-endpoint';
const ENABLED_NAME = 'daily-drill/sync-on';

/** Where to send someone who is not signed in. */
export const SIGNIN_URL = 'https://id.devondoes.dev/';

/** Boot must not stall behind a slow network; a normal pull is ~200ms. */
const PULL_TIMEOUT_MS = 2500;
const PUSH_TIMEOUT_MS = 8000;

export function getEndpoint() {
  try { return localStorage.getItem(ENDPOINT_NAME) || window.DRILL_SYNC_URL || DEFAULT_ENDPOINT; }
  catch { return DEFAULT_ENDPOINT; }
}
export function setEndpoint(url) {
  try { localStorage.setItem(ENDPOINT_NAME, url.replace(/\/+$/, '')); } catch { /* private mode */ }
}

/**
 * Whether this device has opted into syncing. Deliberately a local flag rather
 * than "do we have a session": it has to be answerable synchronously during
 * boot, and the session is only knowable after a round trip.
 */
export const syncConfigured = () => {
  try { return localStorage.getItem(ENABLED_NAME) === '1'; } catch { return false; }
};
export const enableSync = () => {
  try { localStorage.setItem(ENABLED_NAME, '1'); } catch { /* private mode */ }
};
export const disableSync = () => {
  try { localStorage.removeItem(ENABLED_NAME); } catch { /* private mode */ }
};

async function call(path, { method = 'GET', body, timeout = PULL_TIMEOUT_MS } = {}) {
  const endpoint = getEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method,
      signal: controller.signal,
      // The whole point: the platform session travels with the request.
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    // These two are different problems and must not collapse into one message:
    // one is "sign in", the other is "ask for access".
    if (res.status === 401) throw Object.assign(new Error('not signed in'), { code: 'signin' });
    if (res.status === 403) throw Object.assign(new Error('no access to the drill'), { code: 'noaccess' });
    if (!res.ok) throw Object.assign(new Error(`sync failed (${res.status})`), { code: 'http' });
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Is there a usable session for this endpoint? Used by the connect gate. */
export async function checkSession(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
      credentials: 'include',
    });
    if (res.status === 401) return { ok: false, code: 'signin', reason: 'Sign in at id.devondoes.dev first, then try again.' };
    if (res.status === 403) return { ok: false, code: 'noaccess', reason: 'Your account has no access to the drill yet. Ask Devon.' };
    if (!res.ok) return { ok: false, code: 'http', reason: `Sync service error (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, code: 'offline', reason: 'Could not reach the sync service.' };
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
 * Push local work up. The server merges rather than replaces, so this is safe
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
