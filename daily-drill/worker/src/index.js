/**
 * Daily Drill sync (SPEC.md §2, phase 2).
 *
 * A blob store for one person's attempt log. It holds no API key and no model
 * access - the only thing behind it is drill progress.
 *
 * The merge rule is the whole design: attempts are immutable records with unique
 * ids, so merging is a set union and the schedule is recomputed by replay on
 * each device. That means this Worker never has to resolve a conflict, never
 * overwrites a session done on another device, and can accept the same push
 * twice with no effect.
 *
 * It imports mergeAttempts from the app itself rather than reimplementing it,
 * so the client and the server can never disagree about what a merge means.
 */

import { mergeAttempts } from '../../../public/drill/js/srs.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;   // ~5 years of attempts, generously
const STATE_KEY = 'drill:state';

/**
 * Burst limiter, per isolate. Cloudflare fronts this with its own DDoS
 * protection; this exists to make key-guessing pointless rather than to be a
 * general quota. It deliberately does NOT use KV: a counter write per request
 * would burn the 1,000 writes/day free budget the real data needs.
 */
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

function overLimit(ip) {
  const now = Date.now();
  const hits = (HITS.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  hits.push(now);
  HITS.set(ip, hits);
  if (HITS.size > 1000) HITS.clear();          // bound memory in a long-lived isolate
  return hits.length > MAX_PER_WINDOW;
}

/** Constant-time compare so a wrong key leaks nothing through response timing. */
function secretsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Echo the caller's origin only when it is allowed. Echoing a *different*
  // allowed origin on rejection still blocks the browser, but it reads as a
  // successful match in curl and hides configuration mistakes.
  const ok = allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (overLimit(ip)) return json({ error: 'rate limited' }, 429, cors);

    if (!env.DRILL_KEY) return json({ error: 'server not configured' }, 500, cors);
    if (!secretsMatch(request.headers.get('x-api-secret') ?? '', env.DRILL_KEY)) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    const url = new URL(request.url);

    // The gate validates a key against this, matching the convention the other
    // private apps already use.
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);

    if (url.pathname === '/state' && request.method === 'GET') {
      const stored = await env.DRILL.get(STATE_KEY, 'json');
      return json(stored ?? { attempts: [], session_dates: [] }, 200, cors);
    }

    if (url.pathname === '/state' && request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413, cors);

      let incoming;
      try { incoming = JSON.parse(raw); } catch { return json({ error: 'invalid JSON' }, 400, cors); }
      if (!incoming || !Array.isArray(incoming.attempts)) {
        return json({ error: 'expected { attempts: [] }' }, 400, cors);
      }

      const stored = (await env.DRILL.get(STATE_KEY, 'json')) ?? { attempts: [], session_dates: [] };

      // Union, never replace. A device that has been offline for a month pushes
      // a log missing everything the others did; overwriting here would delete
      // that work, so the stored side always survives.
      const merged = {
        attempts: mergeAttempts(stored.attempts ?? [], incoming.attempts),
        session_dates: [...new Set([...(stored.session_dates ?? []), ...(incoming.session_dates ?? [])])].sort().slice(-400),
        catalog_version: incoming.catalog_version ?? stored.catalog_version ?? null,
        updated_at: new Date().toISOString(),
      };

      await env.DRILL.put(STATE_KEY, JSON.stringify(merged));
      return json(merged, 200, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};
