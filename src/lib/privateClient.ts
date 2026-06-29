// Shared config + helpers for the key-gated private apps (/learn, /hub, /games).
// Single source of truth for the backend URL and the localStorage key name so a
// new private page never has to redefine them.

export const API_BASE = 'https://games-backend-production-d763.up.railway.app';
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
  const key = getKey();
  if (!key) throw new Error('No access key');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-secret': key, ...(init.headers || {}) },
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
