#!/usr/bin/env bash
#
# Recall - publish the committed question bank to recall.devondoes.dev.
#
# nightly.sh pushes new questions to GitHub, but Recall is served by Cloudflare
# Pages, which only changes when deploy.mjs --deploy runs. This is that step,
# made safe to run unattended:
#
#   1. The checkout must be clean and exactly equal to origin/main. deploy.mjs
#      ships whatever bank is on disk, so a stale checkout rolls the live bank
#      back (it happened on 2026-09-28). Behind is fast-forwarded; ahead or
#      diverged is refused.
#   2. If the live bank already matches the repo, nothing is deployed.
#   3. After a deploy the live /bank/<lane>.json counts must equal the repo's,
#      or this fails. That is the only proof the deploy took.
#
# Credentials: a Cloudflare API token scoped to Pages:Edit, in
# ~/.cloudflare/pages-token (mode 600). Deliberately NOT the broad account
# token. Override with DRILL_CF_TOKEN_FILE.
#
# Counts only compare questions, so an app-only change (app.js, css) leaves them
# equal and is NOT deployed by a plain run. --force skips that comparison and
# deploys the checkout as it is (still only from a clean checkout equal to
# origin/main, still verified afterwards). Use it after an app-only commit and
# for a rollback: revert, push, then `publish.sh --force`.
#
#   daily-drill/publish.sh            # also safe to run by hand as a catch-up
#   daily-drill/publish.sh --force    # deploy even though live counts match
#   DRILL_PUBLISH_DRY=1 daily-drill/publish.sh   # checks only, never deploys

set -euo pipefail

FORCE=0
case "${1:-}" in
  "") ;;
  --force) FORCE=1 ;;
  *) echo "usage: publish.sh [--force]" >&2; exit 2 ;;
esac

REPO="${DRILL_REPO:-$HOME/DevonMT.github.io}"
LIVE="${DRILL_LIVE_URL:-https://recall.devondoes.dev}"
TOKEN_FILE="${DRILL_CF_TOKEN_FILE:-$HOME/.cloudflare/pages-token}"
# The account id lives beside the token on the mini, not in this public repo.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cat "${DRILL_CF_ACCOUNT_FILE:-$HOME/.cloudflare/account-id}" 2>/dev/null)}"
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "publish: no Cloudflare account id (set CLOUDFLARE_ACCOUNT_ID or write ~/.cloudflare/account-id)" >&2; exit 1; }
export PATH="$HOME/.npm-global/bin:$PATH"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "PUBLISH FAILED: $*"; exit 1; }

cd "$REPO" || fail "no repo at $REPO"

[ -z "$(git status --porcelain)" ] || fail "working tree is dirty; refusing to deploy"
git fetch --quiet origin main || fail "git fetch failed"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git merge-base --is-ancestor HEAD origin/main \
    || fail "checkout is not an ancestor of origin/main (ahead or diverged); refusing to deploy"
  git merge --ff-only --quiet origin/main || fail "could not fast-forward to origin/main"
fi
log "publish: checkout at $(git rev-parse --short HEAD), equal to origin/main"

if [ "$FORCE" != "1" ] && node daily-drill/bank-counts.mjs "$LIVE"; then
  log "publish: nothing to deploy (live counts match; app-only changes need --force)"
  exit 0
fi
[ "${DRILL_PUBLISH_DRY:-0}" != "1" ] || { log "publish: DRY RUN, not deploying"; exit 0; }

[ -s "$TOKEN_FILE" ] || fail "no Cloudflare token at $TOKEN_FILE (needs Pages:Edit)"
CLOUDFLARE_API_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
export CLOUDFLARE_API_TOKEN

log "publish: deploying to Cloudflare Pages"
node daily-drill/deploy.mjs --deploy || fail "deploy.mjs failed"

# Pages takes a moment to promote the new deployment; retry before calling it failed.
for wait in ${DRILL_PUBLISH_WAITS:-5 10 20 30 60}; do
  sleep "$wait"
  if node daily-drill/bank-counts.mjs "$LIVE"; then
    log "publish: live bank verified"
    exit 0
  fi
done
fail "deployed, but the live bank still differs from the repo"
