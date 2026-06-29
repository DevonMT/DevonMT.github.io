#!/usr/bin/env node
/**
 * Theme guard — fails the build if any legacy / off-palette color sneaks back in.
 *
 * Background: the site had two competing palettes. variables.css `:root` and the
 * `#site` BI-Console tokens drifted apart, so pages that used the wrong values
 * rendered "blue" instead of the teal theme. This check scans src/ for the known
 * wrong-palette literals and blocks them so the divergence can't return.
 *
 * It is intentionally a denylist of the *legacy* values — NOT a ban on all raw
 * hex — so it has zero false positives on the existing (correct) code. Add new
 * offenders to LEGACY below as they're retired.
 *
 * Run: `node scripts/check-theme.mjs`  (also wired into `npm run build`)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const SCAN_EXT = new Set(['.astro', '.css', '.ts', '.tsx', '.js', '.jsx']);

// Legacy / wrong-palette values that must never reappear. Each entry: a label and
// a RegExp. Hex entries use a negative lookahead so e.g. #14b8a6 won't match a
// longer 8-digit hex that merely starts the same.
const LEGACY = [
  ['#0a0e27 (old page bg — use var(--color-bg) / #0a0e1a)',        /#0a0e27(?![0-9a-f])/i],
  ['#11162e (old elevated bg — use var(--color-bg-elevated))',     /#11162e(?![0-9a-f])/i],
  ['#161b35 (old surface — use var(--color-surface) / #0d1322)',   /#161b35(?![0-9a-f])/i],
  ['#232a4d (old navy border — use var(--color-border))',          /#232a4d(?![0-9a-f])/i],
  ['#14b8a6 (old dull teal — use var(--color-accent) / #2dd4bf)',  /#14b8a6(?![0-9a-f])/i],
  ['#6b7299 (old faint text — use var(--color-text-faint))',       /#6b7299(?![0-9a-f])/i],
  ['#9aa3c4 (old muted text — use var(--color-text-muted))',       /#9aa3c4(?![0-9a-f])/i],
  ['rgba(20,184,166,…) (old teal in rgba — use rgba(45,212,191,…))', /rgba\(\s*20\s*,\s*184\s*,\s*166/i],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCAN_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [label, re] of LEGACY) {
      if (re.test(line)) {
        violations.push({ file: relative(ROOT, file), line: i + 1, label, text: line.trim() });
      }
    }
  });
}

if (violations.length === 0) {
  console.log('✓ theme guard: no legacy palette values found.');
  process.exit(0);
}

console.error(`\n✗ theme guard: found ${violations.length} legacy palette value(s).`);
console.error('  The site uses one BI-Console palette defined in src/styles/variables.css.');
console.error('  Replace these with the matching var(--color-*) token (or the new hex):\n');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  →  ${v.label}`);
  console.error(`      ${v.text}`);
}
console.error('');
process.exit(1);
