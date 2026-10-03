/**
 * Compare the question bank in the repo with the bank Recall is serving.
 *
 *   node daily-drill/bank-counts.mjs https://recall.devondoes.dev
 *
 * Exits 0 when every lane has the same number of questions, 1 when any lane
 * differs or cannot be read. publish.sh runs it before a deploy (to skip a
 * redundant one) and after (to prove the deploy took), because deploy.mjs
 * ships whatever bank the checkout holds and a stale checkout once rolled
 * the live bank back.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BANK = join(dirname(fileURLToPath(import.meta.url)), 'app', 'bank');

/** { lane: count } for the committed bank. */
export function repoCounts(dir = BANK) {
  const out = {};
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8')).length;
  }
  return out;
}

/** { lane: count } for what `base` serves. A lane that cannot be fetched is null. */
export async function liveCounts(base, lanes, fetchImpl = fetch) {
  const out = {};
  for (const lane of lanes) {
    try {
      // the query string keeps an edge cache from answering with last night's file
      const r = await fetchImpl(`${base.replace(/\/$/, '')}/bank/${lane}.json?t=${Date.now()}`);
      out[lane] = r.ok ? (await r.json()).length : null;
    } catch {
      out[lane] = null;
    }
  }
  return out;
}

/** Lines describing each lane that differs; empty when live matches the repo. */
export function diff(repo, live) {
  return Object.keys(repo)
    .filter(l => live[l] !== repo[l])
    .map(l => `${l}: repo ${repo[l]}, live ${live[l] ?? 'unreadable'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = process.argv[2];
  if (!base) { console.error('usage: bank-counts.mjs <base-url>'); process.exit(2); }
  const repo = repoCounts();
  const bad = diff(repo, await liveCounts(base, Object.keys(repo)));
  const total = Object.values(repo).reduce((a, b) => a + b, 0);
  if (bad.length) { console.log(`live bank differs from repo (${total} questions): ${bad.join('; ')}`); process.exit(1); }
  console.log(`live bank matches repo: ${total} questions`);
}
