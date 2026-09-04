#!/usr/bin/env node
/**
 * Daily Drill - question bank generator (SPEC.md step 11.2)
 *
 * A DESKTOP script. It is not shipped to the browser and is not a runtime
 * dependency of the app (SPEC.md §12) - it reads the concept catalog, asks
 * Claude for questions across the types in §5, validates them hard, and
 * commits them to public/drill/bank/<domain>.json.
 *
 * Nothing here runs at drill time. Questions are generated once and committed
 * so the same prompt recurs identically and the app works offline (§6, §10).
 *
 *   node daily-drill/generate-bank.mjs --domain build --limit 4 --dry-run
 *   node daily-drill/generate-bank.mjs --domain data --limit 20
 *   node daily-drill/generate-bank.mjs --concepts sql.join_fanout,srs.sm2 --force
 *
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile) unless --dry-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CATALOG = path.join(ROOT, 'public/drill/catalog/concepts.json');
const BANK_DIR = path.join(ROOT, 'public/drill/bank');

const MODEL = 'claude-opus-5';
const RUBRIC_VERSION = 1;
// $ per 1M tokens, claude-opus-5
const PRICE = { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 };

const STATIC_TYPES = ['mcq', 'multi', 'cloze', 'spot_error', 'predict_output', 'ordering', 'matching', 'tf_why'];
const FREE_TYPES = ['explain', 'critique', 'when_not', 'breaks_first', 'to_stakeholder', 'push_back', 'estimate'];
const ALL_TYPES = [...STATIC_TYPES, ...FREE_TYPES];
// tf_why is half self-graded, so it counts as free-text for the session-mix rule
const isFree = t => FREE_TYPES.includes(t);

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const a = {
    domain: null, concepts: null, tier: null, limit: null,
    perConcept: 5, batch: 4, types: null,
    dryRun: false, force: false, model: MODEL, effort: 'high',
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const val = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--domain': a.domain = val(); break;
      case '--concepts': a.concepts = val().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--tier': a.tier = val().split(',').map(Number); break;
      case '--limit': a.limit = Number(val()); break;
      case '--per-concept': a.perConcept = Number(val()); break;
      case '--batch': a.batch = Number(val()); break;
      case '--types': a.types = val().split(',').map(s => s.trim()); break;
      case '--model': a.model = val(); break;
      case '--effort': a.effort = val(); break;
      case '--dry-run': a.dryRun = true; break;
      case '--force': a.force = true; break;
      case '--help': case '-h': usage(); process.exit(0); break;
      default: die(`unknown flag: ${flag}`);
    }
  }
  if (a.types) {
    const bad = a.types.filter(t => !ALL_TYPES.includes(t));
    if (bad.length) die(`unknown question types: ${bad.join(', ')}`);
  }
  return a;
}

function usage() {
  console.log(`
generate-bank.mjs - draft question rows for catalog concepts

  --domain <id>          only this domain (data|software|build|ops|comms)
  --concepts <a,b,c>     only these concept ids
  --tier <1,2>           only these tiers
  --limit <n>            stop after n concepts
  --per-concept <n>      questions per concept (default 5: >=2 free-text, >=2 static)
  --batch <n>            concepts per API request (default 4)
  --types <a,b>          restrict to these question types
  --model <id>           default ${MODEL}
  --effort <level>       low|medium|high|xhigh|max (default high)
  --force                regenerate concepts that already have questions
  --dry-run              print the plan and one rendered prompt, call nothing
`);
}

const die = msg => { console.error(`error: ${msg}`); process.exit(1); };

// ---------------------------------------------------------------- io

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadBank(domain) {
  const p = path.join(BANK_DIR, `${domain}.json`);
  return fs.existsSync(p) ? readJson(p) : [];
}

function saveBank(domain, rows) {
  fs.mkdirSync(BANK_DIR, { recursive: true });
  rows.sort((a, b) => (a.concept_id.localeCompare(b.concept_id) || a.id.localeCompare(b.id)));
  fs.writeFileSync(path.join(BANK_DIR, `${domain}.json`), JSON.stringify(rows, null, 2) + '\n');
}

const today = () => new Date().toISOString().slice(0, 10);
const slug = id => id.replace(/[^a-z0-9]+/gi, '_');

function nextId(conceptId, type, taken) {
  const base = `q_${slug(conceptId)}_${type}`;
  for (let n = 1; n < 1000; n++) {
    const id = `${base}_${String(n).padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
  throw new Error(`ran out of ids for ${base}`);
}

// ---------------------------------------------------------------- schema

// One flat shape rather than a discriminated union: unions through structured
// output are brittle, and every per-type rule is enforced in validate() anyway.
const DraftSchema = z.object({
  questions: z.array(z.object({
    concept_id: z.string(),
    type: z.enum(ALL_TYPES),
    prompt: z.string(),
    options: z.array(z.string()).optional(),
    correct_index: z.number().int().optional(),
    correct_indices: z.array(z.number().int()).optional(),
    blanks: z.array(z.object({ accept: z.array(z.string()) })).optional(),
    lines: z.array(z.string()).optional(),
    bad_line: z.number().int().optional(),
    why: z.string().optional(),
    accept: z.array(z.string()).optional(),
    explain: z.string().optional(),
    items: z.array(z.string()).optional(),
    correct_order: z.array(z.number().int()).optional(),
    left: z.array(z.string()).optional(),
    right: z.array(z.string()).optional(),
    pairs: z.array(z.array(z.number().int())).optional(),
    verdict: z.boolean().optional(),
    criteria: z.array(z.string()).optional(),
  })),
});

// ---------------------------------------------------------------- validation

const VAGUE = /\b(well|good|clearly|properly|correctly|thoroughly|appropriate|solid|strong understanding|demonstrates)\b/i;

function checkCriteria(q, errs) {
  const c = q.criteria;
  if (!Array.isArray(c) || c.length < 3 || c.length > 5) return errs.push('rubric needs 3-5 criteria');
  c.forEach((s, i) => {
    if (typeof s !== 'string' || s.length < 15) errs.push(`criterion ${i} too short to check`);
    // §9: "Explains it well" is a bad criterion; it must be mechanically checkable
    else if (VAGUE.test(s)) errs.push(`criterion ${i} is vague ("${s.slice(0, 40)}...")`);
  });
}

const isPermutation = (arr, n) =>
  Array.isArray(arr) && arr.length === n && new Set(arr).size === n && arr.every(i => i >= 0 && i < n);

function validate(q, allowedConcepts) {
  const errs = [];
  if (!allowedConcepts.has(q.concept_id)) errs.push(`concept_id "${q.concept_id}" not in this batch`);
  if (!q.prompt || q.prompt.trim().length < 20) errs.push('prompt too short');

  switch (q.type) {
    case 'mcq': {
      const n = q.options?.length ?? 0;
      if (n < 3 || n > 5) errs.push('mcq needs 3-5 options');
      if (!(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < n)) errs.push('mcq correct_index out of range');
      break;
    }
    case 'multi': {
      const n = q.options?.length ?? 0;
      const c = q.correct_indices ?? [];
      if (n < 4 || n > 6) errs.push('multi needs 4-6 options');
      if (!c.length) errs.push('multi needs at least one correct option');
      if (c.length >= n) errs.push('multi cannot have every option correct');
      if (c.some(i => i < 0 || i >= n)) errs.push('multi correct_indices out of range');
      if (new Set(c).size !== c.length) errs.push('multi correct_indices has duplicates');
      break;
    }
    case 'cloze': {
      const b = q.blanks ?? [];
      if (b.length < 1 || b.length > 2) errs.push('cloze needs 1-2 blanks');
      b.forEach((x, i) => { if (!x.accept?.length) errs.push(`cloze blank ${i} has no accepted answers`); });
      break;
    }
    case 'spot_error': {
      const n = q.lines?.length ?? 0;
      if (n < 3) errs.push('spot_error needs at least 3 lines');
      if (!(Number.isInteger(q.bad_line) && q.bad_line >= 0 && q.bad_line < n)) errs.push('spot_error bad_line out of range');
      if (!q.why?.trim()) errs.push('spot_error needs a why');
      break;
    }
    case 'predict_output':
      if (!q.accept?.length) errs.push('predict_output needs accepted answers');
      if (!q.explain?.trim()) errs.push('predict_output needs an explain');
      break;
    case 'ordering': {
      const n = q.items?.length ?? 0;
      if (n < 3 || n > 6) errs.push('ordering needs 3-6 items');
      if (!isPermutation(q.correct_order, n)) errs.push('ordering correct_order is not a permutation');
      break;
    }
    case 'matching': {
      const n = q.left?.length ?? 0;
      if (n < 3 || n > 5) errs.push('matching needs 3-5 left items');
      if ((q.right?.length ?? 0) !== n) errs.push('matching left and right must be the same length');
      const pairs = q.pairs ?? [];
      if (pairs.length !== n) errs.push('matching needs one pair per left item');
      if (!isPermutation(pairs.map(p => p?.[1]), n)) errs.push('matching pairs must map each right item exactly once');
      if (!isPermutation(pairs.map(p => p?.[0]), n)) errs.push('matching pairs must cover each left item exactly once');
      break;
    }
    case 'tf_why':
      if (typeof q.verdict !== 'boolean') errs.push('tf_why needs a boolean verdict');
      checkCriteria(q, errs);
      break;
    default:
      if (!isFree(q.type)) errs.push(`unhandled type ${q.type}`);
      else checkCriteria(q, errs);
  }
  return errs;
}

/** Normalize a validated draft into the committed row shape (SPEC.md §5). */
function toRow(q, id) {
  const row = {
    id,
    concept_id: q.concept_id,
    type: q.type,
    prompt: q.prompt.trim(),
    scope: 'curriculum',
    origin_capture_id: null,
  };
  switch (q.type) {
    case 'mcq': row.answer = { options: q.options, correct: q.correct_index }; break;
    case 'multi': row.answer = { options: q.options, correct: [...q.correct_indices].sort((a, b) => a - b) }; break;
    case 'cloze': row.answer = { blanks: q.blanks }; break;
    case 'spot_error': row.answer = { lines: q.lines, bad_line: q.bad_line, why: q.why.trim() }; break;
    case 'predict_output': row.answer = { accept: q.accept, explain: q.explain.trim() }; break;
    case 'ordering': row.answer = { items: q.items, correct_order: q.correct_order }; break;
    case 'matching': row.answer = { left: q.left, right: q.right, pairs: q.pairs }; break;
    case 'tf_why':
      row.answer = { correct: q.verdict, rubric: { criteria: q.criteria } };
      row.rubric = { criteria: q.criteria };
      break;
    default: row.rubric = { criteria: q.criteria };
  }
  row.rubric_version = RUBRIC_VERSION;
  row.created_at = today();
  return row;
}

// ---------------------------------------------------------------- prompts

const SYSTEM = `You are drafting questions for Daily Drill, a personal daily micro-learning app for a data engineer / BI analyst.

The point of the app is PRODUCING an explanation, not recognizing an answer. Reviewing feels like understanding and isn't; the gap shows up when you have to explain your own work out loud. Every question you write should push toward being able to talk fluently about the work.

You will be given catalog concepts. Each has a "notes" field that says what knowing that concept actually means. THE NOTES FIELD IS YOUR INSTRUCTION - the question must test what the notes describe, not some adjacent fact about the topic.

QUESTION TYPES

Statically graded (an answer key ships with the question, no model needed at drill time):
- mcq: one right answer. 3-5 options. Distractors must be real misconceptions someone would actually hold - a wrong answer nobody would pick teaches nothing.
- multi: which of these are true. 4-6 options, at least one correct, never all correct.
- cloze: fill the missing term or clause. 1-2 blanks. List every reasonable phrasing in "accept" - this is recall of an idea, not a spelling test.
- spot_error: a short snippet (SQL, Python, YAML, JS) with exactly ONE real bug. "lines" is the snippet split into lines, "bad_line" is the 0-based index, "why" states the bug in one sentence.
- predict_output: given this query or code, what comes back. "accept" lists acceptable answer strings, generously. "explain" says why.
- ordering: 3-6 steps of a real process. "correct_order" is a permutation of item indices giving the right sequence.
- matching: 3-5 concepts paired to definitions or failure modes. "pairs" is [leftIndex, rightIndex], each side used exactly once.
- tf_why: a claim that is definitively true or false. "verdict" is the answer; "criteria" is a rubric for the reasoning.

Free-text (self-graded against a rubric):
- explain: the core rep. What it is and why it matters, in your own words.
- critique: present a plausible-but-wrong explanation and ask what is off. The wrong version must be genuinely tempting, not a strawman.
- when_not: boundary conditions - where the usual answer stops applying.
- breaks_first: failure reasoning under load, scale, or bad input.
- to_stakeholder: explain this to a non-technical stakeholder. Graded on structure, not technical depth.
- push_back: given an ask, what do you cut and how do you say so.
- estimate: produce a number and the reasoning behind it.

RUBRICS - the load-bearing part

Every free-text question (and tf_why) carries 3-5 criteria. A criterion is a BOOLEAN the person can check against their own answer in two seconds. It must be concrete enough that "did I say this?" has an obvious answer.

  GOOD: "States that the frame clause defaults to RANGE, not ROWS"
  GOOD: "Names at least one case where the two differ"
  GOOD: "Says the retry is only safe because the write is idempotent"
  BAD:  "Explains it well"                    (not checkable)
  BAD:  "Demonstrates solid understanding"    (not checkable)
  BAD:  "Discusses the tradeoffs"             (which ones?)

Never use the words: well, good, clearly, properly, correctly, thoroughly, appropriate, solid, demonstrates. If a criterion needs one of those, it is not concrete enough yet - rewrite it as the specific thing that must be said.

For the comms domain, rubrics grade STRUCTURE, not technical correctness: did it name the tradeoff, did it name the audience's actual concern, did it land on a recommendation, did it give a range rather than a false point estimate.

RULES

- Write the prompt so it stands alone. The person sees the prompt only - never "as mentioned above" or a reference to the concept name being visible.
- Prefer the concrete over the abstract. "You join orders to order_items and revenue doubles - what happened?" beats "Describe join fanout."
- No employer, project, table, person or product names from anyone's real work.
- Vary the surface. Do not open every question with the same phrasing.
- Answer keys must be unambiguously right. If a distractor is arguably correct, replace it.
- Snippets stay short - under 12 lines.
- Return ONLY questions for the concept ids you were given.`;

function userPrompt(concepts, perConcept, allowedTypes) {
  const staticAllowed = allowedTypes.filter(t => STATIC_TYPES.includes(t));
  const freeAllowed = allowedTypes.filter(t => isFree(t));
  return `Draft ${perConcept} questions for EACH of the following ${concepts.length} concepts.

For each concept, the mix must include at least 2 free-text questions and at least 2 statically-graded ones, with no type repeated for that concept. A drill session mixes one or two free-text reps with two or three static ones, so the bank needs both for every concept.

Available static types: ${staticAllowed.join(', ')}
Available free-text types: ${freeAllowed.join(', ')}

Pick the types that suit each concept. Some concepts have no natural snippet and should not get spot_error or predict_output; some are judgment calls and want push_back or when_not. Match the type to the material.

CONCEPTS:

${concepts.map(c => `- id: ${c.id}
  name: ${c.name}
  domain: ${c.domain}
  tier: ${c.tier}
  notes: ${c.notes}`).join('\n\n')}

Return ${concepts.length * perConcept} questions total.`;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = readJson(CATALOG);
  const byId = new Map(catalog.map(c => [c.id, c]));

  let selected = catalog;
  if (args.concepts) {
    const missing = args.concepts.filter(id => !byId.has(id));
    if (missing.length) die(`not in catalog: ${missing.join(', ')}`);
    selected = args.concepts.map(id => byId.get(id));
  }
  if (args.domain) selected = selected.filter(c => c.domain === args.domain);
  if (args.tier) selected = selected.filter(c => args.tier.includes(c.tier));
  if (!selected.length) die('no concepts matched those filters');

  // group by domain so each run writes whole bank files
  const domains = [...new Set(selected.map(c => c.domain))];
  const banks = Object.fromEntries(domains.map(d => [d, loadBank(d)]));
  const counts = new Map();
  for (const rows of Object.values(banks)) {
    for (const r of rows) counts.set(r.concept_id, (counts.get(r.concept_id) || 0) + 1);
  }

  if (!args.force) {
    const before = selected.length;
    selected = selected.filter(c => (counts.get(c.id) || 0) < args.perConcept);
    const skipped = before - selected.length;
    if (skipped) console.log(`skipping ${skipped} concept(s) that already have >= ${args.perConcept} questions (--force to regenerate)`);
    if (!selected.length) { console.log('nothing to do.'); return; }
  }
  if (args.limit) selected = selected.slice(0, args.limit);

  const allowedTypes = args.types ?? ALL_TYPES;
  const batches = [];
  for (let i = 0; i < selected.length; i += args.batch) batches.push(selected.slice(i, i + args.batch));

  console.log(`${selected.length} concept(s) across ${domains.join(', ')} -> ${batches.length} request(s), ${args.perConcept} questions each, model ${args.model}`);

  if (args.dryRun) {
    console.log(`\n--- dry run: request 1 of ${batches.length} ---\n`);
    console.log(userPrompt(batches[0], args.perConcept, allowedTypes));
    console.log(`\n(system prompt: ${SYSTEM.length} chars, cached across requests)`);
    console.log(`\nwould write: ${domains.map(d => `public/drill/bank/${d}.json`).join(', ')}`);
    return;
  }

  const client = new Anthropic();
  const usage = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const taken = new Set(Object.values(banks).flat().map(r => r.id));
  let accepted = 0, rejected = 0;

  for (const [n, batch] of batches.entries()) {
    const ids = new Set(batch.map(c => c.id));
    process.stdout.write(`[${n + 1}/${batches.length}] ${batch.map(c => c.id).join(', ')} ... `);

    let response;
    try {
      response = await client.messages.parse({
        model: args.model,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: { effort: args.effort, format: zodOutputFormat(DraftSchema) },
        messages: [{ role: 'user', content: userPrompt(batch, args.perConcept, allowedTypes) }],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) { console.log('rate limited - stopping so progress so far is saved'); break; }
      if (err instanceof Anthropic.AuthenticationError) die('authentication failed - set ANTHROPIC_API_KEY or run `ant auth login`');
      if (err instanceof Anthropic.APIError) { console.log(`API error ${err.status}: ${err.message}`); continue; }
      throw err;
    }

    usage.input += response.usage.input_tokens ?? 0;
    usage.output += response.usage.output_tokens ?? 0;
    usage.cache_write += response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === 'refusal') { console.log(`refused (${response.stop_details?.category})`); continue; }
    if (!response.parsed_output) { console.log('no parsed output - skipped'); continue; }

    const drafts = response.parsed_output.questions;
    const problems = [];
    let took = 0;
    for (const q of drafts) {
      const errs = validate(q, ids);
      if (errs.length) { problems.push(`${q.concept_id}/${q.type}: ${errs.join('; ')}`); rejected++; continue; }
      const id = nextId(q.concept_id, q.type, taken);
      taken.add(id);
      banks[byId.get(q.concept_id).domain].push(toRow(q, id));
      accepted++; took++;
    }
    console.log(`${took} kept${problems.length ? `, ${problems.length} rejected` : ''}`);
    for (const p of problems) console.log(`      × ${p}`);

    for (const d of domains) saveBank(d, banks[d]);  // checkpoint after every batch
  }

  const cost = (usage.input * PRICE.input + usage.output * PRICE.output
    + usage.cache_write * PRICE.cache_write + usage.cache_read * PRICE.cache_read) / 1e6;

  console.log(`\naccepted ${accepted}, rejected ${rejected}`);
  console.log(`tokens: ${usage.input} in, ${usage.output} out, ${usage.cache_write} cache write, ${usage.cache_read} cache read`);
  console.log(`cost: $${cost.toFixed(2)}`);
  for (const d of domains) console.log(`wrote public/drill/bank/${d}.json (${banks[d].length} questions)`);
}

// exported for daily-drill/generate-bank.test.mjs; only run when invoked directly
export { validate, toRow, nextId, STATIC_TYPES, FREE_TYPES, ALL_TYPES };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
