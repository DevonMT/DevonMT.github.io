#!/usr/bin/env node
/**
 * Daily Drill - import hand-authored question drafts into the bank.
 *
 * Same validation and normalization path as generate-bank.mjs, minus the API
 * call: drafts written by hand (or in a chat session) go through the identical
 * per-type checks and rubric rules before anything is committed.
 *
 *   node daily-drill/import-drafts.mjs drafts/data-01.json
 *   node daily-drill/import-drafts.mjs drafts/*.json --dry-run
 *
 * A draft file is a JSON array of objects in the DRAFT shape (not the committed
 * row shape) - see generate-bank.mjs DraftSchema:
 *   { concept_id, type, prompt, ...type-specific answer fields | criteria }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, toRow, nextId, FREE_TYPES, findDuplicate } from './bank-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CATALOG = path.join(ROOT, 'public/drill/catalog/concepts.json');
const BANK_DIR = path.join(ROOT, 'public/drill/bank');

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
if (!files.length) { console.error('usage: import-drafts.mjs <draft.json> [...] [--dry-run]'); process.exit(1); }

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const catalog = readJson(CATALOG);
const byId = new Map(catalog.map(c => [c.id, c]));
const allIds = new Set(byId.keys());

const banks = {};
const loadBank = d => {
  if (!(d in banks)) {
    const p = path.join(BANK_DIR, `${d}.json`);
    banks[d] = fs.existsSync(p) ? readJson(p) : [];
  }
  return banks[d];
};

const taken = new Set();
for (const d of new Set(catalog.map(c => c.domain))) for (const r of loadBank(d)) taken.add(r.id);

let accepted = 0;
const problems = [];
const duplicates = [];
const touchedConcepts = new Set();

// every question already committed, plus everything accepted so far this run,
// so a batch cannot duplicate the bank OR itself
const seenQuestions = [];
for (const d of new Set(catalog.map(c => c.domain))) seenQuestions.push(...loadBank(d));

for (const file of files) {
  const drafts = readJson(file);
  if (!Array.isArray(drafts)) { problems.push(`${file}: not a JSON array`); continue; }

  for (const [i, q] of drafts.entries()) {
    const where = `${path.basename(file)}[${i}] ${q.concept_id}/${q.type}`;
    const errs = validate(q, allIds);
    if (errs.length) { problems.push(`${where}: ${errs.join('; ')}`); continue; }

    const dupe = findDuplicate(q, seenQuestions);
    if (dupe) {
      duplicates.push(`${where}: ${dupe.reason} (${dupe.score}) vs ${dupe.of.id}\n      existing: "${dupe.of.prompt.slice(0, 90)}…"`);
      continue;
    }

    const domain = byId.get(q.concept_id).domain;
    const id = nextId(q.concept_id, q.type, taken);
    taken.add(id);
    const row = toRow(q, id);
    loadBank(domain).push(row);
    seenQuestions.push(row);
    touchedConcepts.add(q.concept_id);
    accepted++;
  }
}

// SPEC.md §5: a session mixes 1-2 free-text reps with 2-3 static ones, so every
// concept in the bank needs both kinds available or selection has nothing to pick.
const warnings = [];
for (const cid of touchedConcepts) {
  const rows = loadBank(byId.get(cid).domain).filter(r => r.concept_id === cid);
  const free = rows.filter(r => FREE_TYPES.includes(r.type)).length;
  const stat = rows.length - free;
  if (free < 2 || stat < 2) warnings.push(`${cid}: ${free} free-text, ${stat} static (want >= 2 of each)`);
  const types = rows.map(r => r.type);
  const dupes = types.filter((t, i) => types.indexOf(t) !== i);
  if (dupes.length) warnings.push(`${cid}: repeated type(s) ${[...new Set(dupes)].join(', ')}`);
}

if (problems.length) {
  console.log(`\n${problems.length} rejected:`);
  for (const p of problems) console.log(`  × ${p}`);
}
if (duplicates.length) {
  console.log(`\n${duplicates.length} skipped as duplicates:`);
  for (const d of duplicates) console.log(`  = ${d}`);
}
if (warnings.length) {
  console.log(`\n${warnings.length} coverage warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (dryRun) {
  console.log(`\ndry run: ${accepted} would be accepted, ${problems.length} rejected. Nothing written.`);
} else if (problems.length) {
  console.log(`\nnothing written - fix the ${problems.length} rejected draft(s) first.`);
  process.exit(1);
} else {
  fs.mkdirSync(BANK_DIR, { recursive: true });
  for (const [domain, rows] of Object.entries(banks)) {
    rows.sort((a, b) => (a.concept_id.localeCompare(b.concept_id) || a.id.localeCompare(b.id)));
    fs.writeFileSync(path.join(BANK_DIR, `${domain}.json`), JSON.stringify(rows, null, 2) + '\n');
    console.log(`wrote public/drill/bank/${domain}.json (${rows.length} questions, ${new Set(rows.map(r => r.concept_id)).size} concepts)`);
  }
  console.log(`\naccepted ${accepted}`);
}
