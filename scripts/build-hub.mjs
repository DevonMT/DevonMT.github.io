/**
 * Build the devondoes.dev deployments of this site: the hub pages (Backlog and
 * Stacks) and the standalone Playfinder.
 *
 * One Astro source produces several sites. `npm run build` makes the personal
 * one for devontroedel.com; this makes the hub build, with
 * PUBLIC_AUTH_MODE=access so the pages call the API same-origin and let the
 * gateway's login cover them, and stages two trimmed copies of it.
 *
 * WHY THIS FILE EXISTS. The hub build was a remembered command, and what it
 * produced was the WHOLE SITE — /about, /blog, /projects, the home page, even
 * the CNAME — all sitting on the hub hostname behind an app login. So each
 * target keeps only what it serves. Adding a page is adding it to that target;
 * forgetting to is a 404, which is the safe direction. Playfinder was the same
 * story one step worse: built by hand and copied by hand, with no script at all.
 *
 * HOW IT GOES LIVE. Each target is a directory a container bind-mounts, so it
 * cannot be swapped for a new one (the container would keep the old one). And
 * a plain copy, which is what this did before, only ever adds: the live hub had
 * accumulated every build's assets. So a deploy uploads to <dir>.incoming, keeps
 * a hard-linked snapshot as <dir>.prev, then syncs in place with --delete and
 * --delay-updates, which renames every changed file in at the end rather than
 * leaving a page that names an asset still in flight. Rolling back is:
 *
 *   ssh dmini 'rsync -a --delete /home/devon/apps/<dir>.prev/ /home/devon/apps/<dir>/'
 *
 *   node scripts/build-hub.mjs            build and stage into dist-hub, dist-playfinder
 *   node scripts/build-hub.mjs --deploy   ...then put both live on the mini and verify
 */
import { execFileSync } from 'node:child_process';
import { rmSync, readdirSync, existsSync, statSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'dist-hub-build');
const HOST = 'dmini';

/**
 * Each deployment: where its files come from in the build, where they go, and
 * the pages that must exist. `files` maps a path in the staged copy to a path
 * in the build. Assets are shared by every page, so _astro comes with each.
 */
const SHARED = { _astro: '_astro', 'ds-chrome.js': 'ds-chrome.js', 'favicon.svg': 'favicon.svg', emblems: 'emblems' };
const TARGETS = [
  {
    name: 'hub',
    out: join(ROOT, 'dist-hub'),
    dir: '/home/devon/apps/games-frontend',       // games-backend's /app/public
    files: { ...SHARED, backlog: 'backlog', stacks: 'stacks' },
    pages: ['backlog/index.html', 'stacks/index.html'],
  },
  {
    name: 'playfinder',
    out: join(ROOT, 'dist-playfinder'),
    dir: '/home/devon/apps/playfinder-frontend',  // playfinder-backend's /app/public
    files: { ...SHARED, 'index.html': 'playfinder-standalone/index.html' },
    pages: ['index.html'],
  },
];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true, ...opts });

// The same checks `npm run build` runs. This script called `astro build`
// directly and so skipped them, which let a type error reach a hub build that
// the personal build would have refused — the hub is not the lesser deployment.
run('node', ['scripts/check-theme.mjs']);
run('npx', ['astro', 'check']);

rmSync(BUILD, { recursive: true, force: true });
run('npx', ['astro', 'build', '--outDir', 'dist-hub-build'], { env: { ...process.env, PUBLIC_AUTH_MODE: 'access' } });

for (const t of TARGETS) {
  rmSync(t.out, { recursive: true, force: true });
  mkdirSync(t.out, { recursive: true });
  for (const [to, from] of Object.entries(t.files)) {
    const src = join(BUILD, from);
    if (!existsSync(src)) {
      console.error(`\n  MISSING ${from} in the build — ${t.name} needs it.`);
      process.exit(1);
    }
    cpSync(src, join(t.out, to), { recursive: true });
  }
  for (const page of t.pages) {
    const p = join(t.out, page);
    if (!existsSync(p) || !statSync(p).size) {
      console.error(`\n  MISSING ${page} — ${t.name} would 404 on its own app.`);
      process.exit(1);
    }
  }
  console.log(`  ${t.name}: staged ${readdirSync(t.out).join(', ')}`);
}
rmSync(BUILD, { recursive: true, force: true });

if (process.argv.includes('--deploy')) {
  for (const t of TARGETS) {
    const incoming = `${t.dir}.incoming`;
    console.log(`\n==> ${t.name}: upload`);
    run('ssh', [HOST, `"rm -rf '${incoming}' && mkdir -p '${incoming}'"`]);
    run('scp', ['-qr', ...readdirSync(t.out).map((n) => `"${join(t.out, n)}"`), `${HOST}:${incoming}/`]);

    console.log(`==> ${t.name}: snapshot, sync in place, verify`);
    // Verification reads the live directory: every page exists, and every
    // /_astro/ or /emblems/ file a page names is there to be served.
    const remote = `set -eu
      rm -rf '${t.dir}.prev' && cp -al '${t.dir}' '${t.dir}.prev'
      rsync -a --delete --delay-updates '${incoming}/' '${t.dir}/'
      rm -rf '${incoming}'
      cd '${t.dir}'; fail=0
      for page in ${t.pages.join(' ')}; do
        [ -s "$page" ] || { echo "    MISSING $page"; fail=1; continue; }
        for ref in $(grep -oE '/(_astro|emblems)/[^"'"'"' )]+' "$page" | sort -u); do
          [ -s ".$ref" ] || { echo "    $page names $ref, which is not there"; fail=1; }
        done
      done
      printf '    %-34s %s\\n' "files live" "$(find . -type f | wc -l)"
      exit $fail`;
    run('ssh', [HOST, 'bash', '-s'], { input: remote, stdio: ['pipe', 'inherit', 'inherit'], shell: false });
    console.log(`    ${t.name} live at ${t.dir}`);
  }
}
