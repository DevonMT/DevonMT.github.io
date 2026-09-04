#!/usr/bin/env node
/**
 * One-shot setup for the Daily Drill sync Worker.
 *
 *   node daily-drill/worker/setup.mjs
 *
 * Logs in if needed, creates the KV namespace, writes its id into
 * wrangler.toml, and deploys. Safe to re-run: an existing namespace id is
 * reused rather than duplicated.
 *
 * It never handles your access key. Setting DRILL_KEY is a separate interactive
 * step that wrangler prompts for, so the secret goes straight from your
 * keyboard to Cloudflare.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOML = path.join(HERE, 'wrangler.toml');
const PLACEHOLDER = 'REPLACE_WITH_KV_NAMESPACE_ID';

const wrangler = (args, opts = {}) =>
  spawnSync('npx', ['--yes', 'wrangler@latest', ...args], {
    cwd: HERE, encoding: 'utf8', shell: process.platform === 'win32', ...opts,
  });

const step = msg => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const die = msg => { console.error(`\n✗ ${msg}`); process.exit(1); };

// 1. auth ---------------------------------------------------------------
step('Checking Cloudflare authentication');
if (wrangler(['whoami']).stdout?.includes('not authenticated')) {
  console.log('  Not logged in — opening a browser for `wrangler login`.');
  if (wrangler(['login'], { stdio: 'inherit' }).status !== 0) die('login failed');
} else {
  console.log('  Already authenticated.');
}

// 2. KV namespace -------------------------------------------------------
let toml = readFileSync(TOML, 'utf8');
if (toml.includes(PLACEHOLDER)) {
  step('Creating the KV namespace');
  const res = wrangler(['kv', 'namespace', 'create', 'DRILL']);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const id = out.match(/id\s*=\s*"([0-9a-f]{32})"/i)?.[1];
  if (!id) {
    console.log(out);
    die('could not read the namespace id from that output — paste it into wrangler.toml by hand and re-run');
  }
  toml = toml.replace(PLACEHOLDER, id);
  writeFileSync(TOML, toml);
  console.log(`  Created and wired up: ${id}`);
} else {
  console.log('\n▸ KV namespace already configured; leaving it alone.');
}

// 3. the secret ---------------------------------------------------------
// Re-running after a failed deploy must not make you type the key again.
const secretList = wrangler(['secret', 'list']);
const alreadySet = `${secretList.stdout ?? ''}`.includes('DRILL_KEY');

if (alreadySet && !process.argv.includes('--rotate-key')) {
  console.log('\n▸ DRILL_KEY is already set; leaving it alone (--rotate-key to replace it).');
} else {
  step('Setting the access key');
  console.log('  wrangler will prompt for it. Use the SAME key the other private');
  console.log('  apps use, so one key unlocks a device everywhere.\n');
  if (wrangler(['secret', 'put', 'DRILL_KEY'], { stdio: 'inherit' }).status !== 0) {
    die('setting DRILL_KEY failed');
  }
}

// 4. deploy -------------------------------------------------------------
step('Deploying');
const deploy = wrangler(['deploy']);
const output = `${deploy.stdout ?? ''}${deploy.stderr ?? ''}`;
console.log(output);
if (deploy.status !== 0) {
  // A new account has no workers.dev subdomain until you pick one, and the
  // error text buries that behind a wall of routing advice.
  if (output.includes('register a workers.dev subdomain')) {
    console.error('\n✗ This Cloudflare account has no workers.dev subdomain yet.');
    console.error('  Pick one at the onboarding link above (it becomes <name>.workers.dev),');
    console.error('  then re-run this script — your key is already set, so it will not ask again.');
    process.exit(1);
  }
  die('deploy failed');
}

const url = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
console.log('\n\x1b[32m✓ Sync is live.\x1b[0m');
if (url) {
  console.log(`\n  Endpoint: ${url}`);
  console.log('\n  Open https://devontroedel.com/drill/ on each device, enter that URL');
  console.log('  and your access key once, and that device syncs from then on.');
}
console.log('\n  Remember to commit the namespace id now in wrangler.toml.');
