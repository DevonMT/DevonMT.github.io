# Daily Drill — Specification

A personal daily micro-learning app. Duolingo's cadence, but the task is
**producing an explanation**, not recognizing an answer.

This document is self-contained and authoritative. It supersedes the original
project brief; where the two disagree, this wins. Section 15 records what
changed and why.

---

## 1. What this is

When an LLM does the drafting, you review answers instead of generating them.
Reviewing feels like understanding and isn't. The gap shows up when you have
to explain your own work out loud. So every session here asks you to produce
something — an explanation, a critique, a judgment call — graded against a
concrete checklist, with misses scheduled to come back.

**Success condition: still opening it in week six.** This constraint outranks
feature completeness everywhere in this document. A feature that adds friction
to the daily loop is a bug regardless of how good it is.

---

## 2. Stack

The app runs in a browser, from a phone, a personal desktop, and a work
laptop. That requirement drives everything below.

- **Client:** static web app. Plain HTML, CSS and JavaScript. No build step,
  no framework, no runtime dependency on npm.
- **Hosting:** GitHub Pages, on the existing personal site.
- **Content:** concept catalog and question bank ship as committed JSON, split
  per domain, loaded on demand.
- **State:** browser `localStorage`, with JSON export/import to move between
  machines.
- **Grading:** self-graded against the rubric checklist. No API key, no
  backend, no network call.
- **Auth:** none. Single user, no accounts, no login.

### Phase 2 — optional, and only when it's worth a setup session

- **Sync:** one Cloudflare Worker with KV (free tier, always on, ~30 lines)
  holding progress state, so all three machines agree.
- **Model grading:** the same Worker, holding the Anthropic key, grading
  free-text answers against the stored rubric. A toggle in the app, never a
  prerequisite.
- **Auth on the Worker:** static bearer token in the client, checked
  server-side, plus a per-token request cap. The endpoint holds an API key and
  sits on the public internet; it does not go up without this.

### Why not the original stack

The first design was Expo/React Native with `expo-sqlite` as the authoritative
device-local store, no sync, and a FastAPI proxy on a self-hosted mini PC.
Three-machine browser use breaks all four choices: a native app isn't
reachable from a work laptop, device-local-and-no-sync is the opposite of what
three machines need, and the mini PC is only reachable over a VPN that resets
on every phone restart. Deleting the mini PC deletes that problem rather than
working around it.

### What this costs

Nothing, in phase 1. Static hosting is free, the bank is a file, grading is a
checkbox. The tradeoff is real and stated plainly: **progress does not sync.**
Answer on the phone and the desktop doesn't know. The export/import button is
the stopgap; the Worker is the fix.

---

## 3. Design constraints

These are foundational, not a settings screen. Each has a concrete
implication; implement the implication, not the vibe.

**Zero decisions before the first question.**
Loading the page goes straight into question one. No home screen, no
dashboard, no "start session" button, no mode picker. Stats and settings live
behind a corner icon the daily path never touches.

**Bounded, visible, finite sessions.**
Default four questions. Progress shown as discrete pips (● ● ○ ○), not a
percentage bar. The end is a hard stop with a clear terminal screen — never an
infinite feed, never a "keep going?" nag.

**No loss states. Ever.**
The single most important rule here. Consecutive-day streaks are actively
harmful: one miss collapses the motivational structure and the app gets
deleted. Instead:

- Track **days active in the last 30** — a rolling count a gap degrades gently.
- No streak-break notification, no flame going out, no "you lost your progress".
- Returning after three weeks shows a normal four-question session, never a
  backlog wall (§7, Return Path).

**Externalize working memory.**
Rubric feedback stays on screen next to your answer. Never require holding a
prompt in your head across a screen transition. Prior answers to the same
concept are one tap away, not a menu dive.

**Non-punitive grading.**
Partial credit by default. Feedback names the missing piece and moves on — no
scores framed as failure, no red X, no "incorrect". A miss is scheduling
information, not a verdict.

**Capture without a chore.**
A nightly "what did you work on today?" prompt will be skipped and then
resented. Capture is a paste box: two seconds, no categorization.
Classification happens later, in a batch, on the desktop.

**Novelty as a feature, not noise.**
Rotate question *types* against the same concept — explain it, critique a
wrong version, when would you not, what breaks first, spot the error. Same
concept, different angle, so review doesn't calcify into memorized phrasing.

**Hyperfocus is welcome but never load-bearing.**
Allow "more questions" after the four. Log extra reps separately from the
schedule so a 40-question binge doesn't blow out every interval and create an
unmanageable backlog three days later.

**Anchored reminders.**
If a reminder exists at all, tie it to a habit that already happens without
effort, not a clock time you'll learn to dismiss. Silenceable, never
escalating, never guilt-toned. A static web app cannot push notifications
reliably; treat this as optional and don't design around it.

---

## 4. The concept catalog

**Build this before writing application code.** It is the schema everything
else depends on.

A static, version-controlled JSON file of ~120–150 concepts with stable string
IDs:

```
sql.window.frame_clause
modeling.scd_type2
pipelines.idempotency
orchestration.backfill_semantics
comms.explaining_tradeoffs
```

### Rules

- **IDs are permanent.** Renaming a display name is fine; changing an ID is a
  migration.
- Two-level hierarchy at most (domain → concept). Deeper trees rot.
- The model drafts it; a human edits and commits it.
- After that, classification files captures *into* the catalog and never
  invents new IDs. An unclassifiable capture gets flagged for review, not a
  new concept.

### Schema

```json
{
  "id": "sql.window.frame_clause",
  "name": "Window frame clause",
  "domain": "data",
  "tier": 2,
  "prereqs": ["sql.window.basics"],
  "notes": "Knowing it means being able to say why RANGE and ROWS differ when there are ties."
}
```

`tier` is 1–3, roughly foundational → advanced. `notes` is one line on what
knowing it actually means — it is the instruction the question generator reads.

### Breadth

The catalog must span well past data engineering. The point is being able to
talk about the work, and the work is not only pipelines.

- **Data core** — SQL, modeling, warehousing, orchestration, quality and
  testing, streaming
- **Software fundamentals** — version control, testing, debugging methodology,
  API design, concurrency basics, cost and performance reasoning
- **The build itself** — static web apps, browser storage, spaced repetition,
  prompt and rubric design, LLM API design. You are building this; that is
  legitimate, well-motivated content and it comes with real captures for free.
- **Systems and ops** — observability, incident response, on-call reasoning,
  failure modes
- **Communication and judgment** — explaining a tradeoff to a non-technical
  stakeholder, scoping and pushing back, writing a design doc, incident comms,
  framing your own work, estimating

That last domain is where "I want to be able to talk about what I do" actually
lives. It is first-class, not a bonus tier. Its questions are graded on
structure and clarity rather than technical correctness, with a distinct
rubric family (§9).

---

## 5. Question types

Most types grade themselves. That is what makes a very large bank cheap: the
majority of reps are instant and free, and the free-text explanation stays the
centerpiece of each session rather than every rep costing a model call.

**A session mixes one or two free-text reps with two or three static ones.**

### Statically graded — no model, no cost

The answer key ships with the question.

| Type | What it asks | Answer shape |
|---|---|---|
| `mcq` | One right answer, distractors built from real misconceptions | `{options: [], correct: 2}` |
| `multi` | Which of these are true. Partial credit falls out naturally | `{options: [], correct: [0,3]}` |
| `cloze` | Fill the missing term or clause | `{blanks: [{accept: ["RANGE"]}]}` |
| `spot_error` | A snippet with one real bug; name the broken line | `{lines: [], bad_line: 4, why: ""}` |
| `predict_output` | Given this query or code, what comes back | `{accept: ["3"], explain: ""}` |
| `ordering` | Put the steps of a process in sequence | `{items: [], correct_order: [2,0,1]}` |
| `matching` | Pair concepts to definitions or failure modes | `{left: [], right: [], pairs: [[0,2]]}` |
| `tf_why` | The verdict grades statically; the reasoning is self-graded | `{correct: true, rubric: {...}}` |

Matching is case-insensitive and whitespace-trimmed. `cloze` and
`predict_output` accept a list of acceptable strings; be generous — this is
recall of an idea, not a spelling test.

### Free-text — self-graded against a rubric

The reps that actually build the skill.

| Type | What it asks |
|---|---|
| `explain` | The core rep. What it is and why it matters, in your own words |
| `critique` | Here is a plausible-but-wrong explanation. What's off? |
| `when_not` | Boundary conditions — where the usual answer stops applying |
| `breaks_first` | Failure reasoning under load, scale, or bad input |
| `to_stakeholder` | Comms domain. Graded on structure, not technical depth |
| `push_back` | Given this ask, what do you cut and how do you say so |
| `estimate` | A number and the reasoning that produced it |

Every type hangs off a catalog concept ID, and one concept can carry many
question rows across many types. That is the rotation §3 asks for,
generalized — and it is exactly why the schedule keys on the concept and not
the question (§6).

### Question schema

```json
{
  "id": "q_sql_window_frame_001",
  "concept_id": "sql.window.frame_clause",
  "type": "explain",
  "prompt": "Explain what changes when you write ROWS BETWEEN instead of RANGE BETWEEN in a window frame.",
  "scope": "curriculum",
  "origin_capture_id": null,
  "rubric": {
    "criteria": [
      "States that the frame clause defaults to RANGE, not ROWS",
      "Identifies that ties are the practical consequence",
      "Gives a case where the two differ"
    ]
  },
  "rubric_version": 1,
  "created_at": "2026-09-03"
}
```

Static types carry an `answer` block instead of `rubric`, shaped per the table
above. `tf_why` carries both.

---

## 6. Data model

### Committed files — served statically

```
/catalog/concepts.json        array of concept objects (no version field: see catalog_version below)
/bank/data.json               questions, one file per domain
/bank/software.json
/bank/build.json
/bank/ops.json
/bank/comms.json
```

Split per domain so the browser loads only what a session needs. A bank of a
few thousand questions is a few megabytes total; per-domain files keep any
single fetch small.

### Runtime state — `localStorage`, one key holding one JSON object

```js
{
  version: 1,
  // Derived from the catalog itself by js/catalog.js, never typed by hand:
  // "<count>c-<hash of the sorted concept ids>". Changes when a concept is
  // added, removed or renamed; not when the file is reformatted or a tier is
  // edited. See "Catalog rot or renames" in the risks table.
  catalog_version: "181c-81a76f92",

  // SRS state — ONE ROW PER CONCEPT, not per question
  schedule: {
    "sql.window.frame_clause": {
      ease: 2.5,
      interval_days: 6,
      due: "2026-09-09",
      reps: 3,
      lapses: 1,
      last_score: 0.67,
      last_answered_at: "2026-09-03T22:41:00Z"
    }
  },

  // append-only; never overwritten
  attempts: [
    {
      id: "a_...",
      question_id: "q_...",
      concept_id: "sql.window.frame_clause",
      answer: "…what you typed…",
      result: { met: [true, true, false] },
      score: 0.67,
      rubric_version: 1,
      graded_by: "self",
      counted_toward_srs: true,
      created_at: "2026-09-03T22:41:00Z"
    }
  ],

  // recent question ids per concept, for type rotation
  seen: { "sql.window.frame_clause": ["q_...", "q_..."] },

  // concepts dropped by the forgetting rule; re-enter as new
  unscheduled: ["orchestration.backfill_semantics"],

  captures: [
    { id: "c_...", body: "…", kind: "text", status: "new", created_at: "…" }
  ],

  session_dates: ["2026-09-01", "2026-09-02", "2026-09-03"]
}
```

Two things worth defending. **Questions are generated once and committed**, so
the same prompt recurs identically and the app works offline. **`attempts` is
append-only**, so you can read back your own explanation from six weeks ago
and watch it improve — one of the few genuinely motivating artifacts this app
can produce.

`localStorage` holds 5–10 MB. Four attempts a day at roughly 500 bytes each is
under a megabyte a year, so this is fine for years. If it ever gets close,
prune attempt *bodies* older than a year and keep the scores.

### Export / import

One button writes the whole state object to a downloaded `.json`, one reads it
back. This is how state moves between machines until the Worker exists. Import
replaces rather than merges — merging two divergent schedules is a source of
subtle wrongness not worth building.

---

## 7. Scheduling

SM-2 as the base — about forty lines, no library — with deliberate
modifications.

### The mapping from rubric to quality

Grading yields *k* of *n* criteria met. SM-2 wants a 0–5 quality. This seam is
defined explicitly and unit-tested:

```
ratio = met / total

ratio >= 0.8  ->  q = 5
ratio >= 0.6  ->  q = 4
ratio >= 0.4  ->  q = 3      # lowest passing grade
ratio >= 0.2  ->  q = 2
else          ->  q = 1

a lapse is any q < 3
```

Statically-graded types produce a ratio too: `mcq`, `cloze`,
`predict_output`, `ordering` and `spot_error` are 1.0 or 0.0; `multi` and
`matching` give a natural partial ratio; `tf_why` averages the verdict with
its rubric ratio.

### The algorithm

```
on answer(concept_id, q, answered_at):
    s = schedule[concept_id] or {ease: 2.5, interval_days: 0, reps: 0, lapses: 0}

    if q >= 3:
        if s.reps == 0:   interval = 1
        elif s.reps == 1: interval = 6
        else:             interval = round(s.interval_days * s.ease)
        s.reps += 1
    else:
        s.reps = 0
        interval = 1
        s.lapses += 1

    s.ease = max(1.8, s.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
    s.interval_days = interval
    s.due = answered_at + interval days
```

**Ease floors at 1.8**, above SM-2's 1.3. Punishing intervals on hard concepts
produce a doom-loop of the same four cards.

**Intervals count from `answered_at`**, never from when a grade landed. This
matters the moment grading is asynchronous.

### Selection

```
SESSION_SIZE = 4
NEW_SLOTS    = 1
FORGET_DAYS  = 60
RETURN_GAP   = 14

1. Apply the forgetting rule: any concept overdue by more than FORGET_DAYS
   moves to `unscheduled` and leaves the queue entirely. It re-enters later as
   new, with no schedule history.

2. Apply the Return Path if the gap since the last session exceeds RETURN_GAP:
   keep the SESSION_SIZE highest-value overdue concepts (most lapses first,
   then lowest tier) and silently redistribute the rest across the next two
   weeks by setting each due date to today + rand(1, 14).

3. due = concepts with due <= today, sorted by (lapses desc, tier asc, due asc)
   Take up to SESSION_SIZE - NEW_SLOTS  (i.e. 3).

4. new = work-derived concepts from recent captures first, then curriculum
   concepts with no schedule row whose prereqs are all satisfied.
   Take up to NEW_SLOTS (i.e. 1).

5. If short of SESSION_SIZE, backfill from remaining due, then from new.

6. For each selected concept, choose a question whose id is not in
   seen[concept_id], preferring a type not recently shown. Push the chosen id
   onto seen[concept_id], capped at the last 5.
```

**Reserved slots, not strict priority.** The original design ranked due
reviews above everything. The moment due volume reaches four a day it never
drops below it, so curriculum stops advancing and capture-derived questions —
the engaging ones — never surface again. That state is permanent and arrives
within weeks. Reserving one slot fixes it.

**The due count is never displayed.** Overflow shifts forward silently.

**Extra reps beyond the session cap do not update schedule state.** Log them
in `attempts` with `counted_toward_srs: false`.

---

## 8. Capture

1. **Paste box** — one screen, one field, one button, no metadata fields.
   Writes to `captures` with `status: "new"`. No processing at capture time.
2. **Classification happens on the desktop**, in a batch, whenever you sit
   down. Not on a schedule — a static site has nowhere to run a nightly job,
   and the original spec's "overnight batch" had no host at all.
3. Each capture is classified to 1–3 catalog IDs, questions are drafted across
   several types, and the result is committed to the bank.
4. Unclassifiable captures go to a review list. They block nothing.

### Two lanes for work content

Work material gets genericized, but actual work stays quizzable. That is two
outputs from one capture, and it is worth building deliberately rather than
discovering later.

**Generic lane** — stripped of employer, table, project and person names, it
becomes an ordinary concept question with `scope: "curriculum"`. Goes in the
committed bank, syncs anywhere, safe on any machine.

**Specific lane** — the literal work detail, `scope: "work"`. Never committed,
never synced, lives only in the browser it was captured in.

One field separates them, so a filter can hide the work lane entirely on a
machine where it shouldn't appear.

---

## 9. Generation and grading

**Rubrics are checklists, not scores.** This is the load-bearing decision for
the app's credibility. A model asked to score an answer 0–100 will grade the
same answer 70 one night and 85 another, and the moment you notice that you
stop trusting the app.

Each free-text question stores 3–5 concrete boolean criteria:

```json
{
  "criteria": [
    "States that the frame clause defaults to RANGE, not ROWS",
    "Identifies that ties are the practical consequence",
    "Gives a case where the two differ"
  ]
}
```

### Phase 1 — self-grading

After you answer, the criteria appear beside what you wrote and you tick the
ones you hit. This works better than it sounds, because criteria like the
first one above are nearly mechanical to check: you either said it or you
didn't. It is free, instant, offline, and it produces exactly the same *k* of
*n* the model would.

Write the criteria to be checkable, not vague. "Explains it well" is a bad
criterion. "Names at least one case where the two differ" is a good one.

### Phase 2 — model grading

Behind a toggle. Returns one boolean plus one sentence per criterion; the
displayed score is how many were met. The answer is stored immediately and
graded on reconnect, so the session never blocks on a request.

### Other requirements

- **Rubrics are versioned.** Editing a rubric bumps `rubric_version` and does
  not invalidate prior attempts. Attempts store the version they were graded
  under, so scores stay comparable.
- **Prompts are version-controlled** with the catalog.
- **Keep a calibration set.** About twenty fixture answers with their expected
  rubric results, run as a test whenever a prompt or rubric changes. Without
  it, "prompts are version-controlled" is decoration — persisting questions
  protects against generation drift, but grading drift is a separate problem
  and this is its only mitigation.
- **Communication rubrics grade structure** — did it name the tradeoff, the
  audience's actual concern, the recommendation — not technical correctness.

---

## 10. Robustness

| Failure | Handling |
|---|---|
| Model drift changes question quality | Questions generated once and committed; prompts version-controlled with the catalog |
| Grading inconsistency | Boolean criteria, not numeric scores; calibration fixture set |
| No network | Everything static and offline-capable; grading is local in phase 1 |
| API cost creep | No runtime model calls at all in phase 1; most question types never need one |
| Catalog rot or renames | `catalog_version` in state, **derived from the concept ids** (`js/catalog.js`) rather than hand-maintained, so it cannot fall out of step with the file. A concept that disappears also loses its bank entries, and `planSession` already skips any concept with no questions — so removal degrades quietly today. The version is the hook for an explicit migration if one is ever needed. |
| Abandonment | Return Path (§7); no loss states anywhere |
| Backlog anxiety | Due count never displayed; overflow silently redistributed; forgetting rule caps the queue |
| Binge distorts schedule | Extra reps excluded from schedule state |
| Progress lost on one machine | Export/import in phase 1; Worker sync in phase 2 |
| Browser storage cleared | Export is the only backup. Say so once, in settings, without nagging |

---

## 11. Build order

Each step ends with something runnable. Do not proceed past a step that isn't
working.

1. **Concept catalog.** ~120–150 IDs across all five domains. Model drafts,
   you edit, you commit.
2. **Question bank generator.** A desktop script taking catalog IDs and
   emitting questions across the types in §5. Run in batches; commit the JSON.
   This is where "very large" gets built.
3. **SM-2 module with unit tests.** Pure functions: the quality mapping, the
   interval algorithm, the forgetting rule, the selection algorithm. No UI, no
   network.
4. **The app, end to end.** Loads the bank, runs a four-question session,
   self-grades, schedules, persists. Deploy to GitHub Pages.

> **Stop here and use it for several nights.** This is a usable app on every
> device you own, with no backend and no running cost. Everything past this
> point is upgrade. Structure the work so that abandoning at any step still
> leaves a working app.

5. **Session UX pass.** Straight into question one on load, pips, terminal
   screen, export/import button, days-active-in-30 as the only stat.
6. **Capture box** and the two-lane generic/work split.
7. **Cloudflare Worker.** Cross-device sync first, then model grading behind a
   toggle. Bearer token and rate cap on the endpoint.
8. **Communication domain rubric family**, graded on structure.

---

## 12. Non-goals

No accounts, no sync in phase 1, no social, no leaderboards, no gamified
currency, no shop, no lesson-tree map, no achievements, no streaks. No build
step, no framework, no runtime npm dependency.

Each of these is a place where scope goes to die, and several actively
conflict with §3.

---

## 13. Still open

- **Which repo this lives in.** The GitHub Pages repo is the obvious home
  since that is what serves it.
- **Session size.** Four is a starting guess, not a finding. Make it a named
  constant and reconsider after a week of real use.
- **Whether the communication domain needs its own cadence.** Those questions
  take longer to answer than a `cloze`. Don't decide in advance.
- **Reminder anchor,** if reminders happen at all.

---

## 14. Opening prompt

Paste this to start a build session. It points at this file and nothing else.

```text
I'm building Daily Drill, a personal daily micro-learning app. The full spec is
in daily-drill/SPEC.md — read it first; it is self-contained and authoritative.

Summary: a static web app on GitHub Pages, plain HTML/CSS/JS with no build
step, that must work in a browser on my phone, my desktop, and my work laptop.
The concept catalog and question bank ship as committed JSON. Progress lives in
localStorage with a JSON export/import button. There is no backend and no API
key in phase 1 — free-text answers are self-graded against a rubric of 3-5
concrete boolean criteria shown after I answer. Scheduling is SM-2 keyed on
concept_id, with the modifications in section 7.

Start with step 1 of section 11 ONLY: draft the concept catalog as JSON.
~120-150 concepts, stable string IDs, two-level hierarchy (domain -> concept),
fields id, name, domain, tier 1-3, prereqs, notes. Follow the breadth
requirements in section 4 — all five domains, with communication and judgment
treated as first-class, not a bonus tier. The notes field is what the question
generator will read, so make it say what knowing the concept actually means.

Draft it for me to edit. Do not write application code yet.
```

---

## 15. What changed from the original brief

The original specified Expo/React Native with `expo-sqlite` as the
authoritative device-local store, no sync, and a FastAPI proxy on a
self-hosted machine. Browser-first use across three machines made all four
choices wrong, and removing the self-hosted machine removed a VPN dependency
that reset on every phone restart.

Seven design corrections were folded in rather than listed as deltas:

1. **Schedule state keys on `concept_id`, not `question_id`** (§6, §7). With
   fifteen question types per concept, per-question scheduling would give one
   idea fifteen independent schedules — an enormous review load for no extra
   learning, and it defeats the point of variety.
2. **Selection reserves slots rather than ranking strictly** (§7). Strict
   priority starves new material permanently once due volume reaches the cap.
3. **A forgetting rule exists** (§7). The Return Path redistributed overflow
   across fourteen days at four a day — fifty-six slots — so a longer absence
   overflowed forever and compounded.
4. **Generation and classification moved to the desktop** (§8). The original
   "overnight batch" had no host: captures lived in device storage, the server
   had no copy, and no reliable nightly job existed on either side.
5. **The rubric-to-quality mapping is defined and testable** (§7). It was
   previously undefined — the seam between grading and scheduling simply had
   no specification.
6. **Intervals count from answer time; attempts store `rubric_version`** (§6,
   §7).
7. **The proxy takes a bearer token and a rate cap** (§2). It holds an API key
   on the public internet. Moot in phase 1, mandatory in phase 2.

The ease floor at 1.8, the four-question cap, the no-loss-states rule, the
checklist-not-score decision, and the whole of §3 are from the original and
were right as written.
