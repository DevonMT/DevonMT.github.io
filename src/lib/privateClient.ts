// Shared config + helpers for the key-gated private apps (/learn, /hub, /games).
// Single source of truth for the backend URL and the localStorage key name so a
// new private page never has to redefine them.

/**
 * Two deployments of the same pages:
 *
 *  - 'key'    (default) - pages served from devontroedel.com, calling the API
 *             cross-origin with a shared secret the user pastes in.
 *  - 'access' - pages served from games.devondoes.dev, SAME-ORIGIN with the
 *             API, behind Cloudflare Access. The Access cookie rides along
 *             automatically, so there is no key and no CORS.
 *
 * Access cannot be used in 'key' mode: it answers an unauthenticated request
 * with a 302 to an interactive login page, which fetch() cannot complete
 * cross-origin. Same-origin is what makes it work.
 */
export const AUTH_MODE: 'key' | 'access' =
  import.meta.env.PUBLIC_AUTH_MODE === 'access' ? 'access' : 'key';

export const API_BASE =
  AUTH_MODE === 'access'
    ? '' // same-origin: /learn, /releases, ... are served by this very host
    : (import.meta.env.PUBLIC_API_BASE ?? 'https://games-backend-production-d763.up.railway.app');

export const KEY_NAME = 'devon_key';

export function getKey(): string | null {
  return localStorage.getItem(KEY_NAME);
}

/**
 * fetch() against the private backend with the saved key attached.
 * On 401 it asks the gate to re-challenge (via the `gate:challenge` event) and throws,
 * so callers don't each have to re-implement the lock-out flow.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  let auth: Record<string, string> = {};
  if (AUTH_MODE === 'key') {
    const key = getKey();
    if (!key) throw new Error('No access key');
    auth = { 'x-api-secret': key };
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // same-origin so the Cloudflare Access cookie is sent in 'access' mode
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...auth, ...(init.headers || {}) },
  });
  if (res.status === 401) {
    document.dispatchEvent(new CustomEvent('gate:challenge', { detail: 'Access key rejected.' }));
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}
