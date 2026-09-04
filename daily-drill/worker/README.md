# Daily Drill sync Worker

A Cloudflare Worker holding one JSON blob: the attempt log. Free tier, no credit
card, nothing to keep warm.

It stores drill progress and nothing else — no API key, no model access. The
worst case if the key leaked is that someone could read or corrupt your drill
history, which `Export` in the app backs up anyway.

## Why the merge rule matters

Attempts are immutable records with unique ids, and `schedule` / `seen` are
derived from them by replay. So the Worker never resolves a conflict: it unions
the incoming log with the stored one and returns the result. Two devices can
push at the same time, a device can be offline for a month, the same push can
arrive twice — none of it loses work.

The Worker imports `mergeAttempts` from the app itself rather than
reimplementing it, so client and server cannot drift apart on what a merge means.

## Deploy

You need a free Cloudflare account. No card required.

```bash
cd daily-drill/worker
npx wrangler login                       # opens a browser once
npx wrangler kv namespace create DRILL   # prints an id
```

Paste that id into `wrangler.toml` under `[[kv_namespaces]]`, then:

```bash
npx wrangler secret put DRILL_KEY        # use the same access key as the other private apps
npx wrangler deploy
```

`deploy` prints the Worker URL. Open the drill on each device, enter that URL and
your key once, and that device syncs from then on.

## Endpoints

All require `x-api-secret: <DRILL_KEY>`.

| Route | Does |
|---|---|
| `GET /health` | Key check. The gate uses this before storing a key. |
| `GET /state` | Returns the stored `{ attempts, session_dates }`. |
| `POST /state` | Unions the posted log into the stored one; returns the merged result. |

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `DRILL_KEY` | secret | The shared access key. Never a `var` — it must not sit in the repo. |
| `ALLOWED_ORIGINS` | `[vars]` | Comma-separated origins allowed to call it. |
| `DRILL` | KV binding | The namespace holding `drill:state`. |

## Budget

The free tier gives 100,000 requests/day, 100,000 KV reads/day and **1,000 KV
writes/day**. Writes are the tight one, and a drill night costs about **one**:
the app pulls on boot and pushes once at the end of a session. Storage is a
fraction of the 1 GB limit — four attempts a day at ~500 bytes is under a
megabyte a year.

## Rate limiting

The burst limiter is per isolate and in memory, deliberately not KV — a counter
write per request would consume the same 1,000 writes/day the real data needs.
It exists to make key-guessing pointless, not as a general quota; Cloudflare's
own DDoS protection sits in front of it. If the key ever leaks, rotate it with
`wrangler secret put DRILL_KEY` and re-enter it on each device.
