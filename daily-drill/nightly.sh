#!/usr/bin/env bash
#
# Daily Drill - nightly question authoring.
#
# Runs on the mini via cron. The model does exactly one thing: answer with a
# JSON array of question drafts, which this script writes to a file.
# Everything that could corrupt the bank - validation, duplicate detection,
# tests, the commit, the push - is done by this script afterwards, so a bad
# night fails loudly and changes nothing.
#
# Model calls go through the ai-broker as the `recall` app (ask-broker.mjs):
# the metered API key, Opus 5.5, under Recall's monthly cap, with an audit line
# per call. It used `claude -p` on the Max subscription until that login
# expired on 2026-10-03 and stopped every night after it (queue #142). This
# script holds no key and needs no login.
#
#   crontab -e
#   0 3 * * * /home/devon/DevonMT.github.io/daily-drill/nightly.sh >> /home/devon/logs/daily-drill.log 2>&1
#
# The last step deploys to Cloudflare Pages; see publish.sh for the token it needs.

set -euo pipefail

REPO="${DRILL_REPO:-$HOME/DevonMT.github.io}"
COUNT="${DRILL_COUNT:-6}"          # concepts per run; ~4 questions each
DRY="${DRILL_DRY:-0}"              # DRILL_DRY=1 does everything except commit and push
BRIEFING="daily-drill/.briefing.json"
DRAFT="daily-drill/drafts/auto-$(date +%F).json"
# a second run on the same day must not collide with the morning's committed draft
[ -e "$REPO/$DRAFT" ] && DRAFT="daily-drill/drafts/auto-$(date +%F-%H%M).json"

# cron gets a minimal PATH
export PATH="$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "FAILED: $*"; exit 1; }
# fail, with the one-line reason ask-broker.mjs left in $2 (the temp file is
# overwritten tomorrow night; the log is not)
fail_call() {
  local why
  why=$(tr -s '\n' ' ' < "$2" 2>/dev/null) || why=""
  fail "$1: ${why:-no reason given}"
}

# A failed run must not poison the next one. Without this the leftover briefing
# and draft leave the tree dirty, and every following night refuses to start.
cleanup() {
  local code=$?
  rm -f "$REPO/$BRIEFING"
  # only discard a draft this run created; never one a previous run committed
  if [ "$code" -ne 0 ] && [ "$DRY" != "1" ] && [ -n "${DRAFT:-}" ]; then
    if ! git -C "$REPO" ls-files --error-unmatch "$DRAFT" >/dev/null 2>&1; then
      rm -f "$REPO/$DRAFT"
      log "cleaned up after a failed run; tomorrow starts from a clean tree"
    fi
  fi
}
trap cleanup EXIT

# Recall is served by Cloudflare Pages, not GitHub Pages: a push alone changes
# nothing live. publish.sh deploys only from a checkout equal to origin/main and
# fails unless the live bank counts match the repo afterwards.
publish() { DRILL_PUBLISH_DRY="$DRY" bash "$REPO/daily-drill/publish.sh" || fail "publish to recall.devondoes.dev failed"; }

command -v node >/dev/null || fail "node not on PATH"
cd "$REPO" || fail "no repo at $REPO"

log "=== daily drill: authoring run ==="

# Start from a clean, current tree. Drafts abandoned by an interrupted run are
# ours to discard - git clean only removes untracked files, so drafts committed
# by previous successful runs are left alone. Anything else dirty is a person's
# work and stops the run rather than being swept into an automated commit.
rm -f "$BRIEFING"
git clean -qf daily-drill/drafts/ 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty; refusing to run"
git pull --rebase --quiet origin main || fail "git pull failed"

# 1. What still needs questions?
node daily-drill/next-concepts.mjs --count "$COUNT" --out "$BRIEFING" || fail "briefing failed"
if [ "$(node -e "process.stdout.write(String(require('./$BRIEFING').concepts.length))")" = "0" ]; then
  log "every concept is covered; nothing to author"
  rm -f "$BRIEFING"
  publish   # still catches the live bank up if an earlier deploy failed
  exit 0
fi

# 2. Claude authors drafts. It sees the rules and the briefing in the prompt and
#    answers with the array; it cannot run commands, touch files or git, or
#    reach the network. ask-broker.mjs writes the array to $DRAFT.
{
  printf '%s\n\n' "The rules for writing questions (daily-drill/AUTHORING.md):"
  cat daily-drill/AUTHORING.md
  printf '\n\n%s\n\n' "The briefing (daily-drill/.briefing.json):"
  cat "$BRIEFING"
  cat <<'ASK'


For each concept in that briefing, write the number of questions its
write_total says, honouring write_free_text and write_static, and avoiding
every type in types_already_used.

Do not restate any prompt in that concept's existing_prompts, and do not
reword one - a near-duplicate is rejected by the importer and the run is
wasted. Write a genuinely different angle on the concept instead.

Reply with the complete JSON array and nothing else. No prose, no markdown
fence, no commentary.
ASK
} > /tmp/drill-author-prompt.txt

log "authoring $DRAFT"
node daily-drill/ask-broker.mjs /tmp/drill-author-prompt.txt "$DRAFT" --array --max-tokens 64000 \
  2> /tmp/drill-run.err || fail_call "authoring call failed" /tmp/drill-run.err

[ -s "$DRAFT" ] || fail "no draft written"
node -e "JSON.parse(require('fs').readFileSync('$DRAFT','utf8'))" || fail "draft is not valid JSON"

# 2b. A second opinion, before anything is imported.
#
#     The structural validator checks shape and is blind to sense. The one
#     genuinely broken question that reached the bank passed every structural
#     check: it referred to "the correlation" without ever saying between what,
#     which also made its own rubric unanswerable. A mechanical rule for that
#     was tried and thrown away — on the real bank it rejected good questions,
#     and a validator that does so gets switched off.
#
#     So the reviewer is a second model call, through the same broker, reading
#     each draft cold with no idea which concept it came from. Failing this
#     step costs one night's questions and nothing else. The verdicts come back
#     in a schema the broker guarantees, so there is no prose to dig out.
REVIEW_RUBRIC='You are reviewing drill questions before they enter a spaced-repetition bank.
Judge each ONE AT A TIME, as a reader who sees only that question, at night, with nothing else on screen.

Drop a question if ANY of these is true:
 - it refers to something it never introduces ("the correlation", "the sample") so the reader cannot know what is meant
 - a rubric criterion cannot be judged from what the prompt actually says
 - the prompt does not state what the reader is meant to do
 - the answer is given away by the wording of the prompt or by one option being obviously the long, careful one
 - it asks for a fact that is wrong, or true only on one database or one version without saying so

Keep everything else. Being terse, opinionated or hard is not a reason to drop.

Give one verdict per question, in the order given.
"index" is the position of the question in the array you were shown, counting from 0.
"reason" is one sentence, only when dropping.'

cat > /tmp/drill-review-schema.json <<'SCHEMA'
{"type": "object", "required": ["verdicts"], "properties": {"verdicts": {"type": "array", "items": {
  "type": "object", "required": ["index", "verdict"],
  "properties": {"index": {"type": "integer"}, "verdict": {"type": "string", "enum": ["keep", "drop"]},
                 "reason": {"type": "string"}}}}}}
SCHEMA
printf '%s\n\nHere are the questions:\n%s\n' "$REVIEW_RUBRIC" "$(cat "$REPO/$DRAFT")" > /tmp/drill-review-prompt.txt

log "reviewing"
node daily-drill/ask-broker.mjs /tmp/drill-review-prompt.txt /tmp/drill-review.txt \
  --schema /tmp/drill-review-schema.json 2> /tmp/drill-run.err \
  || fail_call "review call failed" /tmp/drill-run.err

node daily-drill/review-drafts.mjs "$DRAFT" /tmp/drill-review.txt \
  || fail "review rejected the whole batch (see /tmp/drill-review.txt)"

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
  publish
  exit 0
fi

ADDED=$(node -e "process.stdout.write(String(require('./$DRAFT').length))")

if [ "$DRY" = "1" ]; then
  log "DRY RUN: $ADDED question(s) authored, validated, imported and tested"
  git --no-pager diff --stat daily-drill/app/bank | tail -3
  # Leave no trace: imported-but-uncommitted questions would make the tree dirty
  # and the next real run would refuse to start.
  git checkout -- daily-drill/app/bank
  rm -f "$DRAFT"
  log "DRY RUN: working tree restored, nothing committed or pushed"
  exit 0
fi

git add daily-drill/app/bank "$DRAFT"
git commit --quiet -m "Add $ADDED drilled questions ($(date +%F))

Authored by the nightly routine from daily-drill/AUTHORING.md.
Validated and de-duplicated by daily-drill/import-drafts.mjs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push --quiet origin main || fail "git push failed"

log "pushed $ADDED question(s)"
publish
node daily-drill/next-concepts.mjs --count 1 | tail -1
