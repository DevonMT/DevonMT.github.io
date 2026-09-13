/**
 * Recall - carrying progress over from drill.devondoes.dev.
 *
 * Recall was Daily Drill, at drill.devondoes.dev, and moved to
 * recall.devondoes.dev on its rename. Browser storage belongs to a hostname,
 * so everything kept here lived only under the old one, and a redirect alone
 * would have opened the new one empty. Sync does not cover it: it leaves out
 * work-lane attempts, captures and settings, and on 2026-09-13 the platform
 * held none of the owner's attempts at all.
 *
 * So on its first visit Recall asks the old hostname for what it has. The old
 * hostname keeps serving exactly one page, migrate.html (at /migrate), which the redirect to
 * the new name exempts. Loaded here in a hidden frame, it reads its own storage
 * and posts it back, to this origin and no other. The two hosts are the same
 * site (devondoes.dev), so browsers give that frame its real storage rather
 * than a partitioned, empty copy.
 *
 * The merge is the one sync already trusts: attempts and captures are
 * append-only sets, so nothing already here can be lost. The old copy is never
 * deleted; if anything goes wrong it is still there to try again.
 *
 * Nothing waits for this. It runs beside boot, gives up after a few seconds,
 * and tries again next visit unless it has finished once.
 */

import { mergeState } from './store.js';

const OLD_ORIGIN = 'https://drill.devondoes.dev';
const NEW_ORIGIN = 'https://recall.devondoes.dev';
const DONE = 'recall/handoff-done';
const SYNC_ON = 'daily-drill/sync-on';
const WAIT_MS = 6000;

const done = () => { try { return !!localStorage.getItem(DONE); } catch { return true; } };
const markDone = (note) => { try { localStorage.setItem(DONE, JSON.stringify({ at: new Date().toISOString(), ...note })); } catch { /* private mode */ } };

/**
 * @param {object} state   the state Recall booted with
 * @param {(merged: object) => void} adopt  save the merged state and redraw
 */
export function handoff(state, adopt) {
  if (location.origin !== NEW_ORIGIN || done()) return;

  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.src = `${OLD_ORIGIN}/migrate`;   // Pages serves migrate.html without its extension

  let settled = false;
  const finish = () => { settled = true; removeEventListener('message', onMessage); frame.remove(); };
  const timer = setTimeout(() => { if (!settled) finish(); }, WAIT_MS);   // try again next visit

  function onMessage(e) {
    if (e.origin !== OLD_ORIGIN || e.source !== frame.contentWindow) return;
    const msg = e.data;
    if (!msg || msg.kind !== 'recall-handoff') return;
    clearTimeout(timer);
    finish();

    let incoming = null;
    try { incoming = msg.raw ? JSON.parse(msg.raw) : null; } catch { incoming = null; }
    if (!incoming || !Array.isArray(incoming.attempts)) {
      markDone({ found: 0 });
      return;
    }

    // Settings are the one thing mergeState keeps from the local side, which on
    // a brand-new hostname is only defaults. Take the old ones unless this side
    // already has a history of its own.
    const fresh = !(state.attempts?.length);
    const merged = mergeState(state, incoming);
    if (fresh && incoming.settings) merged.settings = { ...state.settings, ...incoming.settings };

    try { if (msg.syncOn && !localStorage.getItem(SYNC_ON)) localStorage.setItem(SYNC_ON, msg.syncOn); } catch { /* ignore */ }

    const gained = (merged.attempts?.length ?? 0) - (state.attempts?.length ?? 0)
      + (merged.captures?.length ?? 0) - (state.captures?.length ?? 0);
    markDone({ found: incoming.attempts.length, gained });
    if (gained > 0 || fresh) adopt(merged);
  }

  addEventListener('message', onMessage);
  document.body.appendChild(frame);
}
