> **Status: done.** The drill is live at https://drill.devondoes.dev, served by
> Cloudflare Pages from `daily-drill/app/` — always-on, and deliberately not
> through the tunnel, exactly as this note argued. Sync runs on the platform
> instead of the Worker, authenticated by the devondoes.dev session rather than
> a shared key, so there is nothing to type on a new device. The old path
> `devontroedel.com/drill` is now a redirect page.
>
> What follows is the original handoff note, kept for the reasoning.

# Hosting the drill — a handoff note

For whoever moves Daily Drill onto `devondoes.dev`. It covers what the app
needs, what it must not lose, and the two decisions that belong to the portal
architecture rather than to the app.

## What it is

`daily-drill/app/` is a **self-contained static bundle**: 14 files, no build step,
no server, no framework, no runtime dependency. Every reference inside it is
relative, so it can be served from a domain root, a subdirectory, or a Pages
project without a single change.

Serve the folder. That is the whole deployment.

It currently ships as part of the Astro site (Astro copies `public/` verbatim)
and is live at `https://devontroedel.com/drill/`.

## The one hard requirement: always-on

The drill is a nightly habit. Today it works whether the mini is on, off, or
rebooting, because GitHub Pages serves it.

**Do not serve it through the Tunnel to the mini.** A mini reboot would mean no
drilling on a phone, which is a real regression for the one property the app is
designed around — that opening it is never a decision. Cloudflare Pages keeps
always-on availability *and* allows Access in front, so it satisfies both.

The mini's only role in this project is authoring questions at 03:00 (see
`nightly.sh`). It never serves the app and never holds progress.

## Auth: what the move actually buys

The app currently uses a shared access key (`devon_key`, sent as
`x-api-secret`). That is not a preference — it is forced by hosting. The page
sits on `devontroedel.com` and calls `sync.devondoes.dev`, and a cross-origin
`fetch` carries no cookies and cannot follow a login redirect, so a session
login is impossible and a header secret is the only option.

**Serving the app from the same site as the sync API removes that constraint.**
With the app on `devondoes.dev` and Cloudflare Access in front, you get a real
identity login, no key to type on a new device, nothing secret in the page, and
per-device revocation. The key gate can then be deleted.

Note the gate is already skippable ("Drill without syncing"), so nothing breaks
if it is removed before Access is in place.

## Two decisions that belong to the portal design

1. **Hostname.** `drill.devondoes.dev` as its own Access-protected app, or
   `devondoes.dev/drill` as a route inside the portal? Either works — the bundle
   does not care. It affects the DNS record, the Access policy, and the CORS
   list below.
2. **Whether the portal eventually owns sync.** The sync Worker
   (`daily-drill/worker/`) is ~90 lines over a KV blob. If the portal grows a
   real backend, drill progress can move to it: the attempt log ports unchanged
   and every schedule is recomputed by replay, so it is an endpoint swap, not a
   migration.

## After the move — the one thing that will break silently

The sync Worker allows a fixed origin list. It currently allows:

```
https://devontroedel.com
https://devondoes.dev
https://www.devondoes.dev
https://drill.devondoes.dev
http://localhost:4321
```

If the app is served from any other origin, sync fails CORS while the app
itself keeps working — so it looks like sync is broken rather than misconfigured.
Fix by editing `ALLOWED_ORIGINS` in `daily-drill/worker/wrangler.toml` and
running `npx wrangler deploy` from that directory.

A rejected origin returns `Access-Control-Allow-Origin: null`, so it is
unambiguous when testing with curl.

## State and migration

Progress lives in `localStorage` under `daily-drill/v1`, keyed per origin.
**Moving the app to a new hostname means devices start with an empty local log.**
That is not data loss:

- With sync configured, the first boot pulls everything back from the Worker.
- Without sync, Settings → Export on the old origin and Import on the new one.

Worth telling the user once, at cutover, rather than letting them think the
history is gone.

## Checks after the move

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<new-host>/            # 200
curl -s -i -X OPTIONS -H "Origin: https://<new-host>" \
     -H "Access-Control-Request-Method: POST" \
     https://sync.devondoes.dev/state | grep -i access-control-allow-origin
```

The second must echo the new host, not `null`. Then open the app: it should go
straight into question one, and Settings should report the attempt count it is
holding.
