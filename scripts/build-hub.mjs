/**
 * Build the hub deployment: the pages that live on devondoes.dev.
 *
 * One Astro source produces two sites. `npm run build` makes the personal one
 * for devontroedel.com; this makes the hub one, with PUBLIC_AUTH_MODE=access
 * so the pages call the API same-origin and let Cloudflare Access cover them.
 *
 * WHY THIS FILE EXISTS. The hub build was a remembered command, and what it
 * produced was the WHOLE SITE — /about, /blog, /projects, the home page, even
 * the CNAME — all sitting on games.devondoes.dev behind an app login. The
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
const KEEP = new Set(['games', 'learn', '_astro', 'favicon.svg']);

/** Where it goes. The backend mounts this read-only as its static root. */
const TARGET = 'dmini:/home/devon/apps/games-frontend';

rmSync(OUT, { recursive: true, force: true });

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

// /games/discover is Playfinder, which has its own hostname and its own
// deployment. Two URLs for one app compete with each other and only one of
// them is the app's real home.
const discover = join(OUT, 'games', 'discover');
if (existsSync(discover)) {
  rmSync(discover, { recursive: true, force: true });
  dropped++;
}

const kept = readdirSync(OUT);
for (const required of ['games', 'learn']) {
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
