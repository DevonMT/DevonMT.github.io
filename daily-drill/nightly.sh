#!/usr/bin/env bash
#
# Daily Drill - nightly question authoring.
#
# Runs on the mini via cron. Claude Code does exactly one thing: write a JSON
# array of question drafts to a file. Everything that could corrupt the bank -
# validation, duplicate detection, tests, the commit, the push - is done by this
# script afterwards, so a bad night fails loudly and changes nothing.
#
# Uses the Claude Code subscription, NOT API credits. That is why --bare is not
# used anywhere here: bare mode refuses OAuth credentials and demands
# ANTHROPIC_API_KEY.
#
#   crontab -e
#   0 3 * * * /home/devon/DevonMT.github.io/daily-drill/nightly.sh >> /home/devon/logs/daily-drill.log 2>&1

set -euo pipefail

REPO="${DRILL_REPO:-$HOME/DevonMT.github.io}"
COUNT="${DRILL_COUNT:-6}"          # concepts per run; ~4 questions each
DRY="${DRILL_DRY:-0}"              # DRILL_DRY=1 does everything except commit and push
BRIEFING="daily-drill/.briefing.json"
DRAFT="daily-drill/drafts/auto-$(date +%F).json"

# cron gets a minimal PATH; claude lives in the user-prefix npm bin
export PATH="$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

command -v claude >/dev/null || fail "claude not on PATH (npm i -g @anthropic-ai/claude-code)"
command -v node   >/dev/null || fail "node not on PATH"
cd "$REPO" || fail "no repo at $REPO"

log "=== daily drill: authoring run ==="

# Start from a clean, current tree. Refuse to run on top of local edits rather
# than sweeping them into an automated commit.
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty; refusing to run"
git pull --rebase --quiet origin main || fail "git pull failed"

# 1. What still needs questions?
node daily-drill/next-concepts.mjs --count "$COUNT" --out "$BRIEFING" || fail "briefing failed"
if [ "$(node -e "process.stdout.write(String(require('./$BRIEFING').concepts.length))")" = "0" ]; then
  log "every concept is covered; nothing to do"
  rm -f "$BRIEFING"
  exit 0
fi

# 2. Claude authors drafts. Read and Write only - it cannot run commands, touch
#    git, or reach the network. --permission-prompts none is passed only if this
#    CLI version knows the flag.
PROMPT="Read daily-drill/AUTHORING.md for the rules, then read $BRIEFING.

For each concept in that briefing, write the number of questions its
write_total says, honouring write_free_text and write_static, and avoiding
every type in types_already_used.

Do not restate any prompt in that concept's existing_prompts, and do not
reword one - a near-duplicate is rejected by the importer and the run is
wasted. Write a genuinely different angle on the concept instead.

Write the complete JSON array to $DRAFT and nothing else. No prose, no
markdown fence, no commentary."

PERM_FLAGS=()
if claude --help 2>/dev/null | grep -q -- '--permission-prompts'; then
  PERM_FLAGS+=(--permission-prompts none)
fi

log "authoring $DRAFT"
claude -p "$PROMPT" \
  --allowedTools "Read,Write" \
  --permission-mode acceptEdits \
  "${PERM_FLAGS[@]}" \
  --output-format json > /tmp/drill-run.json || fail "claude run failed"

[ -s "$DRAFT" ] || fail "no draft written (see /tmp/drill-run.json)"
node -e "JSON.parse(require('fs').readFileSync('$DRAFT','utf8'))" || fail "draft is not valid JSON"

# 3. Validate, de-duplicate and import. Good drafts land; rejected ones are
#    logged and their concepts simply reappear in tomorrow's briefing. Only a
#    batch where NOTHING was accepted is treated as a failure.
log "importing"
node daily-drill/import-drafts.mjs "$DRAFT" || fail "no questions accepted from this batch"

# 4. The bank is committed content; treat a test failure as a blocker.
log "testing"
npm test --silent >/dev/null || fail "tests failed after import"

# 5. Commit and push. Nothing here is interactive.
rm -f "$BRIEFING"
if [ -z "$(git status --porcelain)" ]; then
  log "import produced no change (all drafts were duplicates)"
  exit 0
fi

ADDED=$(node -e "process.stdout.write(String(require('./$DRAFT').length))")

if [ "$DRY" = "1" ]; then
  log "DRY RUN: $ADDED question(s) imported into the working tree, nothing committed"
  log "review with: git diff --stat && git checkout -- . && rm -f $DRAFT"
  exit 0
fi

git add public/drill/bank "$DRAFT"
git commit --quiet -m "Add $ADDED drilled questions ($(date +%F))

Authored by the nightly routine from daily-drill/AUTHORING.md.
Validated and de-duplicated by daily-drill/import-drafts.mjs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push --quiet origin main || fail "git push failed"

log "pushed $ADDED question(s); site rebuilds on GitHub Pages"
node daily-drill/next-concepts.mjs --count 1 | tail -1
