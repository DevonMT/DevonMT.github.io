/**
 * publish.sh: the unattended deploy step. Each case builds a throwaway origin
 * and checkout, stubs bank-counts.mjs / deploy.mjs, and asserts whether a
 * deploy happened.
 *
 *   node --test daily-drill/publish.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const opts = { skip: !hasBash && 'bash not available' };
const lf = s => s.replace(/\r\n/g, '\n');

function commitFile(dir, name) {
  writeFileSync(join(dir, name), '1');
  git(dir, 'add', name);
  git(dir, 'commit', '-qm', name);
}

/** origin + checkout holding publish.sh and stub node scripts. */
function rig({ liveMatches }) {
  const root = mkdtempSync(join(tmpdir(), 'drill-publish-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 't@t');
  git(work, 'config', 'user.name', 't');
  mkdirSync(join(work, 'daily-drill'));
  // LF endings even when this checkout is CRLF on Windows
  writeFileSync(join(work, 'daily-drill', 'publish.sh'), lf(readFileSync(join(HERE, 'publish.sh'), 'utf8')));
  writeFileSync(join(work, 'daily-drill', 'bank-counts.mjs'),
    "import {existsSync} from 'node:fs'; process.exit(existsSync(process.env.STUB + '/live-match') ? 0 : 1);\n");
  writeFileSync(join(work, 'daily-drill', 'deploy.mjs'), [
    "import {appendFileSync, writeFileSync} from 'node:fs';",
    "appendFileSync(process.env.STUB + '/deployed', process.argv.slice(2).join(' ') + '\\n');",
    "writeFileSync(process.env.STUB + '/live-match', '');",
    '',
  ].join('\n'));
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'main');
  const stub = join(root, 'stub');
  mkdirSync(stub);
  if (liveMatches) writeFileSync(join(stub, 'live-match'), '');
  const token = join(root, 'token');
  writeFileSync(token, 'tok\n');
  const account = join(root, 'account-id');
  writeFileSync(account, 'acct');
  const run = (args = [], env = {}) => {
    const r = spawnSync('bash', [join(work, 'daily-drill', 'publish.sh'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, DRILL_REPO: work, STUB: stub, DRILL_CF_TOKEN_FILE: token,
             DRILL_CF_ACCOUNT_FILE: account, DRILL_PUBLISH_WAITS: '0', ...env },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const deploys = () => existsSync(join(stub, 'deployed'))
    ? readFileSync(join(stub, 'deployed'), 'utf8').trim().split('\n').length : 0;
  /** push one commit to origin from a second clone, leaving `work` behind */
  const pushUpstream = () => {
    const other = join(root, 'other');
    git(root, 'clone', '-q', origin, other);
    git(other, 'config', 'user.email', 't@t');
    git(other, 'config', 'user.name', 't');
    commitFile(other, 'up');
    git(other, 'push', '-q', 'origin', 'main');
  };
  return { root, work, run, deploys, token, pushUpstream };
}

test('lagging live bank: deploys and verifies', opts, () => {
  const t = rig({ liveMatches: false });
  const r = t.run();
  assert.equal(r.code, 0, r.out);
  assert.equal(t.deploys(), 1);
  assert.match(r.out, /live bank verified/);
});

test('live counts already match: nothing deployed, and the log says app-only changes need --force', opts, () => {
  const t = rig({ liveMatches: true });
  const r = t.run();
  assert.equal(r.code, 0, r.out);
  assert.equal(t.deploys(), 0);
  assert.match(r.out, /nothing to deploy.*--force/);
});

test('--force deploys even though counts match (app-only change or rollback)', opts, () => {
  const t = rig({ liveMatches: true });
  const r = t.run(['--force']);
  assert.equal(r.code, 0, r.out);
  assert.equal(t.deploys(), 1);
});

test('--force still refuses a checkout that is not equal to origin/main', opts, () => {
  const t = rig({ liveMatches: true });
  commitFile(t.work, 'local-only');
  const r = t.run(['--force']);
  assert.notEqual(r.code, 0);
  assert.equal(t.deploys(), 0);
  assert.match(r.out, /ahead or diverged/);
});

test('a diverged checkout (local commit plus a new upstream one) is refused', opts, () => {
  const t = rig({ liveMatches: false });
  t.pushUpstream();
  commitFile(t.work, 'local');
  const r = t.run();
  assert.notEqual(r.code, 0);
  assert.equal(t.deploys(), 0);
});

test('a checkout behind origin is fast-forwarded before deploying', opts, () => {
  const t = rig({ liveMatches: false });
  t.pushUpstream();
  const r = t.run();
  assert.equal(r.code, 0, r.out);
  assert.ok(existsSync(join(t.work, 'up')));
  assert.equal(t.deploys(), 1);
});

test('a dirty tree is refused', opts, () => {
  const t = rig({ liveMatches: false });
  writeFileSync(join(t.work, 'dirty'), '1');
  const r = t.run();
  assert.notEqual(r.code, 0);
  assert.equal(t.deploys(), 0);
});

test('DRILL_PUBLISH_DRY never deploys, even with --force', opts, () => {
  const t = rig({ liveMatches: false });
  assert.equal(t.run([], { DRILL_PUBLISH_DRY: '1' }).code, 0);
  assert.equal(t.deploys(), 0);
  const f = rig({ liveMatches: true });
  assert.equal(f.run(['--force'], { DRILL_PUBLISH_DRY: '1' }).code, 0);
  assert.equal(f.deploys(), 0);
});

test('a missing token fails before deploying', opts, () => {
  const t = rig({ liveMatches: false });
  const r = t.run([], { DRILL_CF_TOKEN_FILE: join(t.root, 'nope') });
  assert.notEqual(r.code, 0);
  assert.equal(t.deploys(), 0);
});

test('an unknown argument is a usage error', opts, () => {
  assert.equal(rig({ liveMatches: false }).run(['--nope']).code, 2);
});

// nightly.sh wiring, checked structurally (running it would call claude)
const nightly = lf(readFileSync(join(HERE, 'nightly.sh'), 'utf8'));

test('nightly.sh passes its dry-run flag through to publish.sh', () => {
  assert.match(nightly, /DRILL_PUBLISH_DRY="\$DRY" bash "\$REPO\/daily-drill\/publish\.sh"/);
});

test('nightly.sh: the dry-run authoring exit does not publish; the no-op and real exits do', () => {
  const dryBlock = nightly.slice(nightly.indexOf('if [ "$DRY" = "1" ]; then\n  log "DRY RUN'));
  assert.doesNotMatch(dryBlock.slice(0, dryBlock.indexOf('exit 0')), /publish/);
  assert.match(nightly, /every concept is covered[^\n]*\n[^\n]*\n\s*publish/);
  assert.match(nightly, /all drafts were duplicates\)"\n\s*publish/);
  assert.match(nightly, /pushed \$ADDED question\(s\)"\npublish/);
});
