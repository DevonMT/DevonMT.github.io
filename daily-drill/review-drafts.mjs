/**
 * Daily Drill - the second opinion, between authoring and import.
 *
 * The bank's structural validator is good at shape: 3-5 criteria, options in
 * range, nothing vague. It is blind to sense. The one genuinely broken question
 * that reached the bank passed every structural check and still could not be
 * answered, because it referred to "the correlation" without ever saying
 * between what — and its own rubric then asked the reader to name a variable
 * driving "both measures" that were never named.
 *
 * A mechanical rule for that was tried and thrown away: on 219 real questions
 * it flagged two good ones ("The table has four rows with...", which defines
 * the table as it introduces it) and caught the bad one for the wrong reason.
 * A validator that rejects good work gets switched off, and then it protects
 * nothing. Sense is a judgement, so it takes a judge.
 *
 * This applies verdicts produced by a reviewing model. It does NOT call the
 * model itself: nightly.sh already has `claude` on PATH with the subscription,
 * and keeping the call there means this file stays testable without a network.
 *
 *   node daily-drill/review-drafts.mjs <draft.json> <verdicts.json>
 *
 * Verdicts are keyed by POSITION, not id: a draft has no ids yet — they are
 * assigned at import. Keying on id looked right and would have matched
 * nothing, keeping every question while appearing to review them. That failure
 * is silent, so it is guarded below rather than merely avoided.
 *
 * Anything the reviewer did not mention is KEPT: a reviewer that answers badly
 * may refuse questions but must never quietly empty a batch. Every drop is
 * printed with its reason, because a question thrown away without one teaches
 * nobody anything.
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The subscription path has no structured-output guarantee, so the answer may
 *  arrive wrapped in prose or a fenced block. Find the JSON rather than trust
 *  the shape. */
export function extractVerdicts(raw) {
  const attempts = [];
  const trimmed = String(raw).trim();
  attempts.push(trimmed);

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) attempts.push(fence[1].trim());

  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first !== -1 && last > first) attempts.push(trimmed.slice(first, last + 1));

  for (const a of attempts) {
    try {
      const parsed = JSON.parse(a);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.verdicts)) return parsed.verdicts;
    } catch { /* try the next shape */ }
  }
  return null;
}

/**
 * Returns { kept, dropped, matched } without touching disk, so it can be
 * tested. `matched` is how many verdicts actually landed on a question — the
 * number that tells you whether a review happened at all.
 */
export function applyVerdicts(questions, verdicts) {
  const byIndex = new Map();
  for (const v of verdicts) {
    if (!v || typeof v !== 'object') continue;
    const i = Number(v.index);
    if (Number.isInteger(i) && i >= 0 && i < questions.length) byIndex.set(i, v);
  }

  const kept = [];
  const dropped = [];
  questions.forEach((q, i) => {
    const v = byIndex.get(i);
    if (v && String(v.verdict).toLowerCase() === 'drop') {
      dropped.push({ index: i, reason: v.reason || 'no reason given', prompt: q.prompt });
    } else {
      kept.push(q);
    }
  });
  return { kept, dropped, matched: byIndex.size };
}

// Run as a command, not when imported by a test.
const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const [, , draftPath, verdictPath] = process.argv;
  if (!draftPath || !verdictPath) {
    console.error('usage: review-drafts.mjs <draft.json> <verdicts.json>');
    process.exit(2);
  }

  const questions = JSON.parse(readFileSync(draftPath, 'utf8'));
  const verdicts = extractVerdicts(readFileSync(verdictPath, 'utf8'));

  if (!verdicts) {
    console.error('review: no verdict list could be read; nothing is safe to import');
    process.exit(1);
  }

  const { kept, dropped, matched } = applyVerdicts(questions, verdicts);

  // The silent failure this step is most likely to have: verdicts that parse
  // but line up with nothing, so every question sails through while the log
  // says "reviewed". Refuse the batch instead.
  if (matched === 0) {
    console.error(`review: ${verdicts.length} verdict(s) matched none of the ${questions.length} questions`);
    console.error('review: the reviewer is not answering in the expected shape; importing nothing');
    process.exit(1);
  }

  for (const d of dropped) {
    console.log(`  dropped #${d.index}\n    ${d.reason}\n    "${String(d.prompt).slice(0, 90)}"`);
  }
  console.log(`  review: ${kept.length} kept, ${dropped.length} dropped, ${matched}/${questions.length} judged`);

  if (!kept.length) {
    console.error('review: every question was rejected; committing nothing');
    process.exit(1);
  }
  writeFileSync(draftPath, JSON.stringify(kept, null, 2) + '\n');
}
