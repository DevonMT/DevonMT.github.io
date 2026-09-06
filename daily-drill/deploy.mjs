/**
 * Daily Drill — stamp every asset URL with a version, then deploy that.
 *
 * WHY THIS EXISTS. The bundle has no build step on purpose, so nothing is
 * content-hashed: index.html asks for ./css/app.css by plain name forever. A
 * `_headers` file setting max-age=0 fixes that at the origin, and it works —
 * on daily-drill.pages.dev. It does not work on drill.devondoes.dev, because
 * the zone rewrites Cache-Control to a four-hour browser TTL, overriding what
 * the origin says. Same file, same deployment, different answer:
 *
 *   daily-drill.pages.dev   Cache-Control: public, max-age=0, must-revalidate
 *   drill.devondoes.dev     Cache-Control: public, max-age=14400, must-revalidate
 *
 * That setting is Devon's to change and worth changing. Until it is, a deploy
 * leaves returning devices on yesterday's stylesheet for up to four hours —
 * which is how a re-themed drill kept rendering in the old palette — and, more
 * dangerous, on yesterday's JavaScript beside today's HTML.
 *
 * A version in the query string sidesteps all of it: index.html is not cached,
 * so a new URL is fetched immediately, whatever the TTL says about the old one.
 *
 * The rewrite happens on a COPY. The source bundle stays plain, relative and
 * buildless, which is the property that let it move hosts without edits.
 *
 *   node daily-drill/deploy.mjs           # stage, print the directory
 *   node daily-drill/deploy.mjs --deploy  # stage, then wrangler pages deploy
 */
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), 'app');

/** One version for the whole bundle: the hash of everything that can change.
 *  Simpler than per-file hashes and just as correct — a deploy either changed
 *  something or it did not. */
function version() {
  const h = createHash('sha256');
  const feed = dir => {
    for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const full = join(dir, name.name);
      if (name.isDirectory()) feed(full);
      else h.update(name.name).update(readFileSync(full));
    }
  };
  feed(APP);
  return h.digest('hex').slice(0, 8);
}

export function stamp(dir, v) {
  const q = `?v=${v}`;

  // index.html: the stylesheet and the entry module.
  const idx = join(dir, 'index.html');
  let html = readFileSync(idx, 'utf8');
  html = html.replace('href="./css/app.css"', `href="./css/app.css${q}"`);
  html = html.replace('src="./js/app.js"', `src="./js/app.js${q}"`);
  writeFileSync(idx, html);

  // Every module's own imports. Stamping only the entry would leave a new
  // app.js importing a cached srs.js, which is worse than stamping nothing.
  const jsDir = join(dir, 'js');
  for (const name of readdirSync(jsDir)) {
    if (!name.endsWith('.js')) continue;
    const p = join(jsDir, name);
    let js = readFileSync(p, 'utf8');
    js = js.replace(/(from\s+'\.\/[A-Za-z0-9_.-]+\.js)'/g, `$1${q}'`);
    // The data the app fetches at runtime changes nightly and caches the same way.
    js = js.replace("fetch('./catalog/concepts.json')", `fetch('./catalog/concepts.json${q}')`);
    js = js.replace('fetch(`./bank/${d}.json`)', `fetch(\`./bank/\${d}.json${q}\`)`);
    js = js.replace("'/static/charts.js'", "'/static/charts.js'"); // not this bundle
    writeFileSync(p, js);
  }
  return q;
}

const v = version();
const staged = mkdtempSync(join(tmpdir(), 'drill-'));
cpSync(APP, staged, { recursive: true });
const q = stamp(staged, v);

console.log(`  version ${v}`);
console.log(`  staged  ${staged}`);
const check = readFileSync(join(staged, 'index.html'), 'utf8');
console.log(`  index references: ${(check.match(/\.(css|js)\?v=[0-9a-f]{8}/g) || []).join(', ')}`);
const appjs = readFileSync(join(staged, 'js', 'app.js'), 'utf8');
console.log(`  app.js stamped imports: ${(appjs.match(/\.js\?v=[0-9a-f]{8}/g) || []).length}`);

if (process.argv.includes('--deploy')) {
  execFileSync('npx', ['--yes', 'wrangler@latest', 'pages', 'deploy', staged,
    '--project-name=daily-drill', '--branch=main', '--commit-dirty=true'],
    { stdio: 'inherit', shell: true });
  rmSync(staged, { recursive: true, force: true });
}
