#!/usr/bin/env node
/**
 * Daily Drill - build the briefing for a question-authoring run.
 *
 * Picks the concepts most in need of questions and writes everything the author
 * needs to avoid repeating themselves: the concept's notes, the types it already
 * carries, and every prompt already in the bank for it.
 *
 *   node daily-drill/next-concepts.mjs --count 6 --out daily-drill/.briefing.json
 *   node daily-drill/next-concepts.mjs --count 3            # prints a summary
 *
 * Exits 0 with an empty concept list when the bank is complete, so the nightly
 * wrapper can stop cleanly rather than asking for questions nobody needs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_TYPES, STATIC_TYPES, isFree } from './bank-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CATALOG = path.join(ROOT, 'public/drill/catalog/concepts.json');
const BANK_DIR = path.join(ROOT, 'public/drill/bank');

/**
 * A concept is "done" at this many questions, with the free/static mix below.
 * Raise DRILL_TARGET later to deepen the bank without touching this file.
 */
export const TARGET_PER_CONCEPT = Number(process.env.DRILL_TARGET ?? 4);
const MIN_FREE = 2;
const MIN_STATIC = 2;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const count = Number(flag('--count', 6));
const out = flag('--out', null);
const domainFilter = flag('--domain', null);

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const catalog = readJson(CATALOG);

const bank = [];
for (const d of [...new Set(catalog.map(c => c.domain))]) {
  const p = path.join(BANK_DIR, `${d}.json`);
  if (fs.existsSync(p)) bank.push(...readJson(p));
}

const byConcept = new Map();
for (const q of bank) {
  if (!byConcept.has(q.concept_id)) byConcept.set(q.concept_id, []);
  byConcept.get(q.concept_id).push(q);
}

/** What this concept still needs to be considered covered. */
function gap(concept) {
  const rows = byConcept.get(concept.id) ?? [];
  const free = rows.filter(r => isFree(r.type)).length;
  const stat = rows.length - free;
  const needFree = Math.max(0, MIN_FREE - free);
  const needStatic = Math.max(0, MIN_STATIC - stat);
  const needTotal = Math.max(TARGET_PER_CONCEPT - rows.length, needFree + needStatic);
  return { rows, free, stat, needFree, needStatic, needTotal };
}

const candidates = catalog
  .filter(c => !domainFilter || c.domain === domainFilter)
  .map(c => ({ concept: c, ...gap(c) }))
  .filter(x => x.needTotal > 0)
  // untouched concepts first, then foundations, then a stable order
  .sort((a, b) =>
    (a.rows.length - b.rows.length)
    || (a.concept.tier - b.concept.tier)
    || a.concept.id.localeCompare(b.concept.id));

const chosen = candidates.slice(0, count);

const briefing = {
  generated_at: new Date().toISOString(),
  target_per_concept: TARGET_PER_CONCEPT,
  free_types: FREE_TYPES,
  static_types: STATIC_TYPES,
  remaining_concepts: candidates.length,
  concepts: chosen.map(({ concept, rows, needFree, needStatic, needTotal }) => ({
    id: concept.id,
    name: concept.name,
    domain: concept.domain,
    tier: concept.tier,
    notes: concept.notes,
    write_total: needTotal,
    write_free_text: needFree,
    write_static: needStatic,
    types_already_used: rows.map(r => r.type),
    // every existing prompt, so the author cannot restate one by accident
    existing_prompts: rows.map(r => r.prompt),
  })),
};

if (out) {
  fs.writeFileSync(path.join(ROOT, out), JSON.stringify(briefing, null, 2) + '\n');
  console.log(`briefing: ${chosen.length} concept(s), ${chosen.reduce((n, c) => n + c.needTotal, 0)} question(s) to write`);
  console.log(`${candidates.length} concept(s) still short of ${TARGET_PER_CONCEPT}`);
} else {
  for (const c of briefing.concepts) {
    console.log(`${c.id.padEnd(34)} have ${c.types_already_used.length}, write ${c.write_total} (${c.write_free_text} free / ${c.write_static} static)`);
  }
  console.log(`\n${candidates.length} concept(s) still short of ${TARGET_PER_CONCEPT}; ${catalog.length - candidates.length} covered`);
}
