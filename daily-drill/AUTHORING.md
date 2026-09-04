# Daily Drill — question authoring rules

These are the rules for writing questions for the bank. They are read by the
nightly routine and by any session that authors questions by hand, so that a
question written six months from now matches one written today.

The full design is in `SPEC.md`; this file is only about writing good questions.

## The point

The app exists because reviewing feels like understanding and isn't. Every
question should push toward **producing** an explanation or a judgment, not
recognising an answer. The reader is a data engineer / BI analyst who wants to
talk fluently about their work.

Each concept in `public/drill/catalog/concepts.json` carries a `notes` field
saying what knowing that concept actually means. **The notes field is the
instruction.** Test what the notes describe, not some adjacent fact.

## Question types

### Statically graded — the answer key ships with the question

| Type | What it asks | Answer fields |
|---|---|---|
| `mcq` | One right answer, 3–5 options | `options`, `correct_index` |
| `multi` | Which are true, 4–6 options, never all correct | `options`, `correct_indices` |
| `cloze` | Fill the missing term, 1–2 blanks | `blanks: [{accept: []}]` |
| `spot_error` | A snippet with exactly one real bug | `lines`, `bad_line` (0-based), `why` |
| `predict_output` | What does this return | `accept: []`, `explain` |
| `ordering` | 3–6 steps in sequence | `items`, `correct_order` (a permutation) |
| `matching` | 3–5 pairs, each side used once | `left`, `right`, `pairs: [[l, r]]` |
| `tf_why` | A claim that is definitively true or false | `verdict`, plus `criteria` |

### Free-text — self-graded against a rubric

`explain`, `critique`, `when_not`, `breaks_first`, `to_stakeholder`,
`push_back`, `estimate`. Each carries `criteria`.

## Rubrics — the load-bearing part

Every free-text question (and `tf_why`) carries **3–5 criteria**. A criterion is
a boolean the person can check against their own answer in two seconds.

```
GOOD: "States that the frame clause defaults to RANGE, not ROWS"
GOOD: "Names at least one case where the two differ"
GOOD: "Says the retry is only safe because the write is idempotent"
BAD:  "Explains it well"                  (not checkable)
BAD:  "Demonstrates solid understanding"  (not checkable)
BAD:  "Discusses the tradeoffs"           (which ones?)
```

**These words are rejected by the validator**: well, good, clearly, properly,
correctly, thoroughly, appropriate, solid, demonstrates. If a criterion needs
one of them, it is not concrete enough yet — rewrite it as the specific thing
that must be said.

**Each criterion must be at least 15 characters.** A criterion short enough to
fail that is never checkable anyway — "Says it is true" tells you nothing about
what you were supposed to say. Write the actual claim: "States that a PUT can be
repeated without changing the result".

`tf_why` carries a full rubric too. Its criteria grade the *reasoning*, not the
verdict — the verdict is already graded by `verdict`. Do not write criteria like
"Answers true"; write what the explanation had to contain.

For the **comms** domain, rubrics grade *structure*, not technical correctness:
did it name the tradeoff, did it name the audience's real concern, did it land
on a recommendation, did it give a range rather than a false point estimate.

## Rules

- **Never repeat an existing question.** The briefing lists every prompt already
  in the bank for each concept. A reworded version of one of those is a
  duplicate and will be rejected — write a genuinely different angle instead.
- Each concept needs **at least 2 free-text and at least 2 static** questions,
  and no type repeated within a concept. The briefing says which types are
  already used.
- The prompt must stand alone. The person sees only the prompt — never "as
  mentioned above", and never a reference to the concept name being on screen.
- Prefer the concrete over the abstract. *"You join orders to order_items and
  revenue doubles — what happened?"* beats *"Describe join fanout."*
- No employer, project, table, person or product names from real work.
- Vary the opening. Not every question starts "Explain what…".
- Answer keys must be unambiguously right. If a distractor is arguably correct,
  replace it. The best distractor is a mistake someone would actually make.
- Snippets stay under 12 lines. Use backticks for inline code — the app renders
  them as code spans.
- Match the type to the material: a concept with no natural snippet should not
  get `spot_error` or `predict_output`; a judgment call wants `push_back` or
  `when_not`.

## Output format

Write a JSON array of draft objects. Drafts use flat fields (not the committed
row shape) — `daily-drill/import-drafts.mjs` validates and normalises them:

```json
[
  {
    "concept_id": "sql.window.frame_clause",
    "type": "explain",
    "prompt": "Explain what changes when you write ROWS BETWEEN instead of RANGE BETWEEN in a window frame.",
    "criteria": [
      "States that the frame clause defaults to RANGE, not ROWS",
      "Identifies ties as the practical consequence",
      "Gives a case where the two produce different numbers"
    ]
  },
  {
    "concept_id": "sql.window.frame_clause",
    "type": "mcq",
    "prompt": "Three rows share the same ORDER BY value. Under the default frame, what does a running SUM return for the first of them?",
    "options": ["Only its own value", "The total including all three tied rows", "NULL", "Its own value plus the next row"],
    "correct_index": 1
  }
]
```

Write nothing but the JSON array to the output file. No commentary, no prose
around it, no markdown fence.
