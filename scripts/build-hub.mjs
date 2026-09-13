/**
 * Build the hub deployment: the pages that live on devondoes.dev.
 *
 * One Astro source produces two sites. `npm run build` makes the personal one
 * for devontroedel.com; this makes the hub one, with PUBLIC_AUTH_MODE=access
 * so the pages call the API same-origin and let Cloudflare Access cover them.
 *
 * WHY THIS FILE EXISTS. The hub build was a remembered command, and what it
 * produced was the WHOLE SITE — /about, /blog, /projects, the home page, even
 * the CNAME — all sitting on the hub hostname behind an app login. The
 * personal site is not part of the hub and had no business being served from
 * it, and the catch-all static handler meant every unknown path there returned
 * the personal home page.
 *
 * So this trims to what the hub actually serves. Adding a page to the hub is
 * adding it to KEEP; forgetting to is a 404, which is the safe direction.
 *
 *   node scripts/build-hub.mjs            build and stage into dist-hub
 *   node scripts/build-hub.mjs --deploy   ...then copy to the mini
 */
import { execFileSync } from 'node:child_process';
import { rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-hub');

/** Everything the hub serves. Assets are shared, so _astro comes too. */
const KEEP = new Set(['backlog', 'stacks', '_astro', 'favicon.svg', 'ds-chrome.js', 'emblems']);

/** Where it goes. The backend mounts this read-only as its static root. */
const TARGET = 'dmini:/home/devon/apps/games-frontend';

rmSync(OUT, { recursive: true, force: true });

// The same checks `npm run build` runs. This script called `astro build`
// directly and so skipped them, which let a type error reach a hub build that
// the personal build would have refused — the hub is not the lesser deployment.
execFileSync('node', ['scripts/check-theme.mjs'], { cwd: ROOT, stdio: 'inherit', shell: true });
execFileSync('npx', ['astro', 'check'], { cwd: ROOT, stdio: 'inherit', shell: true });

execFileSync('npx', ['astro', 'build', '--outDir', 'dist-hub'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PUBLIC_AUTH_MODE: 'access' },
});

let dropped = 0;
for (const name of readdirSync(OUT)) {
  if (KEEP.has(name)) continue;
  rmSync(join(OUT, name), { recursive: true, force: true });
  dropped++;
}

const kept = readdirSync(OUT);
for (const required of ['backlog', 'stacks']) {
  const page = join(OUT, required, 'index.html');
  if (!existsSync(page) || !statSync(page).size) {
    console.error(`\n  MISSING ${required}/index.html — the hub would 404 on its own app.`);
    process.exit(1);
  }
}
console.log(`\n  hub build: kept ${kept.join(', ')}  (dropped ${dropped} top-level entries)`);

if (process.argv.includes('--deploy')) {
  execFileSync('scp', ['-r', ...kept.map((n) => join(OUT, n)), TARGET + '/'],
    { stdio: 'inherit', shell: true });
  console.log(`  deployed to ${TARGET}`);
}
