/**
 * Daily Drill - session flow (SPEC.md §3, §5).
 *
 * Loading this page goes straight into question one. There is no home screen,
 * no start button, and no mode picker; settings live behind the corner icon
 * that the daily path never touches.
 */

import {
  planSession, scoreStatic, ratioFromRubric, daysActive,
  SESSION_SIZE, toDay,
} from './srs.js';
import * as store from './store.js';
import * as sync from './sync.js';

const CATALOG_VERSION = '2026-09-03';
const DOMAINS = ['data', 'software', 'build', 'ops', 'comms'];
const FREE_TYPES = new Set(['explain', 'critique', 'when_not', 'breaks_first', 'to_stakeholder', 'push_back', 'estimate']);
const needsRubric = q => FREE_TYPES.has(q.type) || q.type === 'tf_why';

const el = document.getElementById('app');
const pipsEl = document.getElementById('pips');
const today = toDay(new Date().toISOString());

let state = store.load();
let catalog = [];
let conceptById = new Map();
let questionsByConcept = {};
let queue = [];
let index = 0;
let bonusRound = false;

// ---------------------------------------------------------------- helpers

const h = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...kids.filter(Boolean));
  return node;
};

const clear = node => { while (node.firstChild) node.firstChild.remove(); };

/**
 * Prompts are plain text, but questions about SQL and code read badly without
 * code spans. `backticks` become <code>; everything else stays a text node, so
 * nothing authored in the bank can inject markup.
 */
function withCodeSpans(text) {
  const out = [];
  for (const [i, part] of String(text).split('`').entries()) {
    if (!part) continue;
    out.push(i % 2 ? h('code', { class: 'inline-code', text: part }) : document.createTextNode(part));
  }
  return out;
}
const persist = () => store.save(state);

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    const [cat, ...banks] = await Promise.all([
      fetch('./catalog/concepts.json').then(r => r.json()),
      ...DOMAINS.map(d => fetch(`./bank/${d}.json`).then(r => (r.ok ? r.json() : [])).catch(() => [])),
    ]);
    catalog = cat;
    conceptById = new Map(catalog.map(c => [c.id, c]));

    const showWork = state.settings.show_work_lane;
    for (const rows of banks) {
      for (const q of rows) {
        if (q.scope === 'work' && !showWork) continue;
        (questionsByConcept[q.concept_id] ??= []).push(q);
      }
    }

    if (state.catalog_version !== CATALOG_VERSION) {
      state = { ...state, catalog_version: CATALOG_VERSION };
    }

    // A device that has not turned sync on sees the gate once; it can also be
    // declined, because the app is fully usable without sync.
    if (!sync.syncConfigured()) {
      if (!state.settings.sync_declined) return showGate();
    } else {
      // Pull before planning so a session done on another device is already
      // reflected and its questions are not asked again. Short timeout: offline
      // this fails fast and the session starts anyway.
      const res = await sync.reconcile(state);
      if (res.ok) { state = res.state; persist(); }
      else if (res.reason === 'unauthorized') return showGate('That key was rejected. Enter it again.');
    }
    startSession();
  } catch (err) {
    console.error(err);
    renderLoadError(err);
  }
}

function startSession({ bonus = false } = {}) {
  bonusRound = bonus;
  // schedule and seen are derived inside planSession from the attempt log;
  // there is no session state to write back
  const plan = planSession({ state, catalog, questionsByConcept, today });
  queue = plan.picks;
  index = 0;
  if (!bonus) state = store.markSessionDay(state, today);
  persist();

  if (!queue.length) return renderEmpty();
  renderPips();
  renderQuestion();
}

// ---------------------------------------------------------------- gate

function showGate(errorMessage) {
  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const endpointInput = document.getElementById('gate-endpoint');
  const submit = document.getElementById('gate-submit');
  const error = document.getElementById('gate-error');

  document.getElementById('app').hidden = true;
  gate.hidden = false;
  endpointInput.value = sync.getEndpoint() ?? '';
  if (errorMessage) { error.textContent = errorMessage; error.hidden = false; }
  setTimeout(() => submit.focus(), 50);

  document.getElementById('gate-skip').addEventListener('click', () => {
    // Declining is remembered, so the gate is asked once and never nags.
    state = { ...state, settings: { ...state.settings, sync_declined: true } };
    persist();
    dismissGate();
    startSession();
  }, { once: true });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const endpoint = endpointInput.value.trim();
    if (!endpoint) return;

    error.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Checking…';
    const check = await sync.checkSession(endpoint);
    submit.disabled = false;
    submit.textContent = 'Connect';

    if (!check.ok) {
      error.textContent = check.reason;
      error.hidden = false;
      // Not signed in is the one failure the user can fix from here, so offer
      // the door rather than only naming the problem.
      if (check.code === 'signin') {
        document.getElementById('gate-signin').hidden = false;
      }
      return;
    }

    sync.setEndpoint(endpoint);
    sync.enableSync();
    state = { ...state, settings: { ...state.settings, sync_declined: false } };
    const res = await sync.reconcile(state);
    if (res.ok) state = res.state;
    persist();
    dismissGate();
    startSession();
  });
}

function dismissGate() {
  document.getElementById('gate').hidden = true;
  document.getElementById('app').hidden = false;
}

/** Push after a session. Fire-and-forget: a drill is never held up by sync. */
function syncInBackground() {
  if (!sync.syncConfigured()) return;
  sync.reconcile(state).then(res => {
    if (res.ok) { state = res.state; persist(); }
  });
}

// ---------------------------------------------------------------- chrome

function renderPips() {
  clear(pipsEl);
  for (let i = 0; i < Math.max(queue.length, SESSION_SIZE); i++) {
    const state_ = i < index ? 'done' : i === index ? 'current' : 'todo';
    pipsEl.append(h('li', { 'data-state': state_ }));
  }
}

function renderLoadError(err) {
  clear(el);
  el.append(h('div', { class: 'empty' },
    h('h1', { text: "Couldn't load tonight's questions" }),
    h('p', { text: 'The question bank did not load. If you are opening this file directly, serve the folder over HTTP instead — fetch does not work from file:// URLs.' }),
    h('p', { class: 'note', text: String(err?.message ?? err) }),
  ));
}

function renderEmpty() {
  clear(pipsEl);
  clear(el);
  el.append(h('div', { class: 'empty' },
    h('h1', { text: 'Nothing scheduled' }),
    h('p', { text: 'Every concept with questions is either answered for now or waiting on a prereq. Add more questions to the bank and come back.' }),
    h('p', { class: 'note' }, h('code', { text: 'node daily-drill/import-drafts.mjs daily-drill/drafts/*.json' })),
  ));
}

// ---------------------------------------------------------------- question

function renderQuestion() {
  const { question: q, concept_id } = queue[index];
  const concept = conceptById.get(concept_id);
  renderPips();
  clear(el);

  const meta = h('div', { class: 'q-meta' },
    h('span', { class: 'concept', text: `// ${concept_id}` }),
    h('span', { class: 'chip', text: q.type.replace(/_/g, ' ') }),
    q.scope === 'work' ? h('span', { class: 'chip work', text: 'work' }) : null,
  );

  const control = buildControl(q);
  const rubricBox = needsRubric(q) ? buildRubric(q) : null;
  const feedback = h('div');
  const actions = h('div', { class: 'actions' });

  const primary = h('button', { class: 'btn-primary', type: 'button' },
    document.createTextNode(needsRubric(q) ? 'Show the checklist' : 'Check'));
  actions.append(primary);

  el.append(meta, h('h1', { class: 'prompt' }, ...withCodeSpans(q.prompt)), control.node);
  if (rubricBox) { rubricBox.node.hidden = true; el.append(rubricBox.node); }
  el.append(feedback, actions);

  const priorAnswers = store.attemptsForConcept(state, concept_id).slice(0, 3);
  if (priorAnswers.some(a => a.answer)) el.append(buildPrior(priorAnswers));

  let phase = 'answer';

  primary.addEventListener('click', () => {
    if (phase === 'answer') {
      if (!control.ready()) return;
      control.lock();
      if (rubricBox) {
        // free-text and tf_why: the criteria appear beside what you wrote, and
        // stay there. Never a screen transition (SPEC §3).
        rubricBox.node.hidden = false;
        rubricBox.focus();
        primary.textContent = 'Done';
        phase = 'rubric';
        return;
      }
      grade();
      return;
    }
    if (phase === 'rubric') { grade(); return; }
    advance();
  });

  function grade() {
    const response = { ...control.read(), met: rubricBox ? rubricBox.read() : undefined };
    const score = needsRubric(q) && q.type !== 'tf_why'
      ? ratioFromRubric(response.met)
      : scoreStatic(q, response);

    control.showGrade(response);
    if (rubricBox) rubricBox.showGrade();
    feedback.replaceWith(buildFeedback(q, score, response));
    feedback.remove();

    const at = new Date().toISOString();
    state = store.recordAttempt(state, {
      question: q,
      answer: response.text ?? '',
      met: response.met ?? null,
      score,
      countedTowardSrs: !bonusRound,
      at,
    });
    // Appending the attempt IS the state change. The schedule follows from it on
    // the next replay, and extra reps carry counted_toward_srs: false so a binge
    // never reshapes intervals (§7).
    persist();

    primary.textContent = index + 1 < queue.length ? 'Next' : 'Finish';
    phase = 'done';
    primary.focus();
  }

  function advance() {
    index += 1;
    if (index >= queue.length) return renderDone();
    renderQuestion();
  }

  // Enter advances once graded; digits pick options while answering.
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (phase === 'done' || (phase !== 'answer' && ev.metaKey))) {
      ev.preventDefault();
      primary.click();
    }
  });
}

function buildPrior(attempts) {
  const box = h('details', { class: 'prior' }, h('summary', { text: '// what you said before' }));
  for (const a of attempts) {
    if (!a.answer) continue;
    box.append(h('blockquote', {},
      h('time', { text: a.created_at.slice(0, 10) }),
      document.createTextNode(a.answer)));
  }
  return box;
}

// ---------------------------------------------------------------- feedback

/** Names the missing piece and moves on. No score framed as failure, no red X. */
function buildFeedback(q, score, response) {
  const box = h('div', { class: score >= 0.8 ? 'feedback' : 'feedback partial' });
  const a = q.answer ?? {};

  if (needsRubric(q)) {
    const missed = (response.met ?? []).filter(x => !x).length;
    const total = (response.met ?? []).length;
    box.append(h('strong', {
      text: missed === 0 ? 'All of it.' : `${total - missed} of ${total}.`,
    }));
    if (missed) box.append(h('span', { class: 'why', text: 'The unticked ones above are what to reach for next time.' }));
  }

  if (q.type === 'spot_error') {
    box.append(h('strong', { text: response.line === a.bad_line ? 'That is the line.' : `Line ${a.bad_line + 1}.` }));
    box.append(h('span', { class: 'why', text: a.why }));
  } else if (q.type === 'predict_output') {
    box.append(h('strong', { text: score === 1 ? 'Right.' : `Answer: ${a.accept?.[0] ?? ''}` }));
    if (a.explain) box.append(h('span', { class: 'why', text: a.explain }));
  } else if (q.type === 'mcq' || q.type === 'multi' || q.type === 'ordering' || q.type === 'matching' || q.type === 'cloze') {
    box.append(h('strong', {
      text: score === 1 ? 'Right.' : score > 0 ? 'Partly — the rest is marked above.' : 'The answer is marked above.',
    }));
  } else if (q.type === 'tf_why') {
    box.append(h('span', { class: 'why', text: `The claim is ${a.correct ? 'true' : 'false'}.` }));
  }
  return box;
}

// ---------------------------------------------------------------- rubric

function buildRubric(q) {
  const criteria = q.rubric?.criteria ?? q.answer?.rubric?.criteria ?? [];
  const node = h('div', { class: 'rubric' }, h('div', { class: 'eyebrow', text: '// tick what you actually said' }));
  const buttons = criteria.map(text => {
    const btn = h('button', { class: 'crit', type: 'button', 'aria-pressed': 'false' },
      h('span', { class: 'box' }), h('span', { text }));
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
    return btn;
  });
  node.append(...buttons);
  return {
    node,
    focus: () => buttons[0]?.focus(),
    read: () => buttons.map(b => b.getAttribute('aria-pressed') === 'true'),
    showGrade: () => buttons.forEach(b => {
      b.disabled = true;
      if (b.getAttribute('aria-pressed') !== 'true') b.dataset.grade = 'missed';
    }),
  };
}

// ---------------------------------------------------------------- controls

function buildControl(q) {
  switch (q.type) {
    case 'mcq': return choiceControl(q, false);
    case 'multi': return choiceControl(q, true);
    case 'tf_why': return tfControl(q);
    case 'cloze': return clozeControl(q);
    case 'predict_output': return textFieldControl(q);
    case 'spot_error': return spotErrorControl(q);
    case 'ordering': return orderingControl(q);
    case 'matching': return matchingControl(q);
    default: return freeTextControl();
  }
}

function optionButton(label, { multi = false, badge = null } = {}) {
  return h('button', { class: 'opt', type: 'button', 'aria-pressed': 'false', 'data-multi': multi || null },
    badge ?? h('span', { class: 'mark' }),
    h('span', {}, ...withCodeSpans(label)));
}

function choiceControl(q, multi) {
  const opts = q.answer.options.map(label => optionButton(label, { multi }));
  const node = h('div', { class: 'options' }, ...opts);
  opts.forEach((btn, i) => btn.addEventListener('click', () => {
    if (!multi) opts.forEach(o => o.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }));
  const picked = () => opts.map((b, i) => (b.getAttribute('aria-pressed') === 'true' ? i : -1)).filter(i => i >= 0);
  return {
    node,
    ready: () => picked().length > 0,
    lock: () => opts.forEach(b => { b.disabled = true; }),
    read: () => (multi ? { choices: picked() } : { choice: picked()[0] }),
    showGrade: () => {
      const correct = new Set(multi ? q.answer.correct : [q.answer.correct]);
      opts.forEach((b, i) => {
        const chose = b.getAttribute('aria-pressed') === 'true';
        if (chose && correct.has(i)) b.dataset.grade = 'hit';
        else if (chose) b.dataset.grade = 'missed';
        else if (correct.has(i)) b.dataset.grade = 'key';
      });
    },
  };
}

function tfControl(q) {
  const opts = [['True', true], ['False', false]].map(([label]) => optionButton(label));
  const node = h('div', { class: 'tf' }, ...opts);
  opts.forEach(btn => btn.addEventListener('click', () => {
    opts.forEach(o => o.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
  }));
  const verdict = () => (opts[0].getAttribute('aria-pressed') === 'true' ? true
    : opts[1].getAttribute('aria-pressed') === 'true' ? false : null);
  return {
    node,
    ready: () => verdict() !== null,
    lock: () => opts.forEach(b => { b.disabled = true; }),
    read: () => ({ verdict: verdict() }),
    showGrade: () => {
      const rightIndex = q.answer.correct ? 0 : 1;
      opts.forEach((b, i) => {
        const chose = b.getAttribute('aria-pressed') === 'true';
        if (i === rightIndex) b.dataset.grade = 'hit';
        else if (chose) b.dataset.grade = 'missed';
      });
    },
  };
}

function clozeControl(q) {
  const inputs = q.answer.blanks.map((_, i) =>
    h('input', { class: 'field', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: `blank ${i + 1}` }));
  const node = h('div', { class: 'blanks' }, ...inputs);
  return {
    node,
    ready: () => inputs.every(i => i.value.trim()),
    lock: () => inputs.forEach(i => { i.disabled = true; }),
    read: () => ({ texts: inputs.map(i => i.value), text: inputs.map(i => i.value).join(' / ') }),
    showGrade: () => inputs.forEach((input, i) => {
      const ok = (q.answer.blanks[i].accept ?? []).some(x => x.trim().toLowerCase() === input.value.trim().toLowerCase());
      if (!ok) input.value = `${input.value}  →  ${q.answer.blanks[i].accept?.[0] ?? ''}`;
    }),
  };
}

function textFieldControl(q) {
  const input = h('input', { class: 'field', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'your answer' });
  return {
    node: h('div', { class: 'blanks' }, input),
    ready: () => input.value.trim().length > 0,
    lock: () => { input.disabled = true; },
    read: () => ({ text: input.value }),
    showGrade: () => {},
  };
}

function spotErrorControl(q) {
  const lines = q.answer.lines.map((src, i) =>
    h('li', {}, h('button', { class: 'line', type: 'button', 'aria-pressed': 'false' },
      h('span', { class: 'ln', text: String(i + 1).padStart(2, ' ') }),
      h('span', { text: src }))));
  const buttons = lines.map(li => li.firstChild);
  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
  }));
  const picked = () => buttons.findIndex(b => b.getAttribute('aria-pressed') === 'true');
  return {
    node: h('ol', { class: 'lines' }, ...lines),
    ready: () => picked() >= 0,
    lock: () => buttons.forEach(b => { b.disabled = true; }),
    read: () => ({ line: picked() }),
    showGrade: () => buttons.forEach((b, i) => {
      const chose = b.getAttribute('aria-pressed') === 'true';
      if (i === q.answer.bad_line) b.dataset.grade = chose ? 'hit' : 'key';
      else if (chose) b.dataset.grade = 'missed';
    }),
  };
}

function orderingControl(q) {
  const order = [];
  const opts = q.answer.items.map((label, i) => {
    const badge = h('span', { class: 'badge' });
    const btn = optionButton(label, { badge });
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const at = order.indexOf(i);
      if (at >= 0) order.splice(at, 1); else order.push(i);
      repaint();
    });
    return { btn, badge, i };
  });
  const node = h('div', {},
    h('div', { class: 'ord' }, ...opts.map(o => o.btn)),
    h('p', { class: 'hint', text: 'tap in order — tap again to remove' }));

  function repaint() {
    for (const { btn, badge, i } of opts) {
      const pos = order.indexOf(i);
      btn.setAttribute('aria-pressed', pos >= 0 ? 'true' : 'false');
      badge.textContent = pos >= 0 ? String(pos + 1) : '';
    }
  }
  repaint();

  return {
    node,
    ready: () => order.length === q.answer.items.length,
    lock: () => opts.forEach(o => { o.btn.disabled = true; }),
    read: () => ({ order: [...order] }),
    showGrade: () => {
      const right = q.answer.correct_order;
      opts.forEach(({ btn, badge, i }) => {
        const pos = order.indexOf(i);
        const shouldBe = right.indexOf(i);
        btn.dataset.grade = pos === shouldBe ? 'hit' : 'missed';
        if (pos !== shouldBe) badge.textContent = String(shouldBe + 1);
      });
    },
  };
}

function matchingControl(q) {
  const rows = q.answer.left.map((label, i) => {
    const select = h('select', {},
      h('option', { value: '', text: '—' }),
      ...q.answer.right.map((r, j) => h('option', { value: String(j), text: r })));
    const row = h('div', { class: 'pair' }, h('span', { text: label }), select);
    return { row, select, i };
  });
  return {
    node: h('div', { class: 'pairs' }, ...rows.map(r => r.row)),
    ready: () => rows.every(r => r.select.value !== ''),
    lock: () => rows.forEach(r => { r.select.disabled = true; }),
    read: () => ({ pairs: rows.map(r => [r.i, Number(r.select.value)]) }),
    showGrade: () => {
      const key = new Map(q.answer.pairs.map(([l, r]) => [l, r]));
      rows.forEach(r => {
        const ok = key.get(r.i) === Number(r.select.value);
        r.row.dataset.grade = ok ? 'hit' : 'missed';
        if (!ok) r.select.value = String(key.get(r.i));
      });
    },
  };
}

function freeTextControl() {
  const box = h('textarea', { class: 'answer', placeholder: 'In your own words…', spellcheck: 'true' });
  return {
    node: box,
    ready: () => box.value.trim().length > 0,
    lock: () => { box.disabled = true; },
    read: () => ({ text: box.value.trim() }),
    showGrade: () => {},
  };
}

// ---------------------------------------------------------------- done

/** A hard stop. No "keep going?" nag; the extra reps are opt-in and quiet. */
function renderDone() {
  clear(el);
  renderPipsAllDone();
  syncInBackground();
  const active = daysActive(state.session_dates, today);
  el.append(h('div', { class: 'done' },
    h('h1', { text: bonusRound ? 'That is the extra round.' : 'Done for tonight.' }),
    h('p', { text: 'Nothing else is waiting. Anything you missed will come back on its own schedule.' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn-secondary', type: 'button', onClick: () => startSession({ bonus: true }) },
        document.createTextNode('A few more')),
    ),
    h('p', { class: 'stat' },
      h('span', { class: 'stat-num', text: String(active) }),
      h('span', { class: 'stat-label', text: `${active === 1 ? 'day' : 'days'} active in the last 30` })),
  ));
}

function renderPipsAllDone() {
  clear(pipsEl);
  for (let i = 0; i < queue.length; i++) pipsEl.append(h('li', { 'data-state': 'done' }));
}

// ---------------------------------------------------------------- settings

const dlg = document.getElementById('settings');
document.getElementById('settings-open').addEventListener('click', () => {
  document.getElementById('stat-num').textContent = String(daysActive(state.session_dates, today));
  document.getElementById('opt-work-lane').checked = state.settings.show_work_lane;
  document.getElementById('capture-count').textContent =
    state.captures.length ? `${state.captures.length} waiting to be sorted` : '';
  document.getElementById('sync-status').textContent = sync.syncConfigured()
    ? `Syncing with ${new URL(sync.getEndpoint()).host} as your signed-in account. ${state.attempts.length} attempts held.`
    : 'Not syncing on this device. Progress stays in this browser only.';
  document.getElementById('storage-note').textContent = store.storageAvailable
    ? `catalog ${state.catalog_version ?? '—'} · ${state.attempts.length} attempts stored`
    : 'This browser is blocking local storage, so tonight will not be saved.';
  dlg.showModal();
});
document.getElementById('settings-close').addEventListener('click', () => dlg.close());

document.getElementById('opt-work-lane').addEventListener('change', ev => {
  state = { ...state, settings: { ...state.settings, show_work_lane: ev.target.checked } };
  persist();
  location.reload();
});

document.getElementById('btn-sync').addEventListener('click', async ev => {
  const btn = ev.target;
  const status = document.getElementById('sync-status');
  if (!sync.syncConfigured()) { dlg.close(); return showGate(); }
  btn.disabled = true;
  const before = state.attempts.length;
  const res = await sync.reconcile(state);
  btn.disabled = false;
  if (!res.ok) {
    status.textContent =
      res.reason === 'signin'   ? 'You are signed out. Sign in at id.devondoes.dev, then sync again.'
      : res.reason === 'noaccess' ? 'Your account has no access to the drill yet. Ask Devon for it.'
      : `Sync failed: ${res.message}. Your progress here is untouched.`;
    return;
  }
  state = res.state;
  persist();
  const gained = state.attempts.length - before;
  status.textContent = gained
    ? `Synced. ${gained} attempt${gained === 1 ? '' : 's'} arrived from another device.`
    : 'Synced. Everything was already up to date.';
});

document.getElementById('btn-forget').addEventListener('click', () => {
  if (!confirm('Stop syncing on this device? Your progress here stays, but it will stop syncing.')) return;
  sync.disableSync();
  document.getElementById('sync-status').textContent = 'This device no longer syncs.';
});

document.getElementById('btn-export').addEventListener('click', () => {
  const url = URL.createObjectURL(store.exportBlob(state));
  const a = h('a', { href: url, download: store.exportFilename(today) });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', async ev => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const imported = store.parseImport(await file.text());
    const merged = store.mergeState(state, imported);
    const added = merged.attempts.length - state.attempts.length;
    if (!confirm(`Merge ${imported.attempts.length} attempts from that file? ${added} are new here; nothing already on this device is lost.`)) return;
    state = merged;
    persist();
    location.reload();
  } catch (err) {
    alert(`That file could not be imported: ${err.message}`);
  }
});

document.getElementById('btn-capture').addEventListener('click', () => {
  const box = document.getElementById('capture-body');
  const body = box.value.trim();
  if (!body) return;
  state = store.addCapture(state, body);
  persist();
  box.value = '';
  document.getElementById('capture-count').textContent = `${state.captures.length} waiting to be sorted`;
});

boot();
