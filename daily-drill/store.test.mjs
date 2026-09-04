/**
 * Tests for persistence, migration and the sync payload.
 *
 *   node --test daily-drill/store.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, mergeState, syncPayload, parseImport, emptyState, STATE_VERSION } from '../public/drill/js/store.js';

const at = (id, concept_id, created_at, extra = {}) => ({
  id, concept_id, question_id: `${concept_id}_q`, score: 1, created_at,
  counted_toward_srs: true, ...extra,
});

test('a v1 blob migrates without losing a single attempt', () => {
  const v1 = {
    version: 1,
    catalog_version: '2026-09-03',
    schedule: { 'sql.join_types': { ease: 2.5, due: '2026-09-09', reps: 3 } },
    seen: { 'sql.join_types': ['q1', 'q2'] },
    unscheduled: ['old.concept'],
    attempts: [at('a1', 'sql.join_types', '2026-09-01T20:00:00Z')],
    captures: [{ id: 'c1', body: 'note', status: 'new' }],
    session_dates: ['2026-09-01'],
    settings: { show_work_lane: false },
  };
  const v2 = migrate(v1);

  assert.equal(v2.version, STATE_VERSION);
  assert.deepEqual(v2.attempts, v1.attempts, 'the log is the thing that mattered');
  assert.deepEqual(v2.captures, v1.captures);
  assert.deepEqual(v2.session_dates, v1.session_dates);
  assert.equal(v2.settings.show_work_lane, false, 'device settings survive');
  // derived state is dropped, because it is now recomputed from the log
  assert.equal('schedule' in v2, false);
  assert.equal('seen' in v2, false);
  assert.equal('unscheduled' in v2, false);
});

test('migrate fills defaults and tolerates a junk blob', () => {
  const s = migrate({});
  assert.deepEqual(s.attempts, []);
  assert.deepEqual(s.session_dates, []);
  assert.equal(s.settings.show_work_lane, true);

  const junk = migrate({ attempts: 'not an array', captures: null });
  assert.deepEqual(junk.attempts, []);
  assert.deepEqual(junk.captures, []);
});

test('migrate does not downgrade a newer stored version', () => {
  assert.equal(migrate({ version: 99, attempts: [] }).version, 99);
});

test('parseImport rejects a file that is not an export', () => {
  assert.throws(() => parseImport('{"hello":"world"}'), /not a Daily Drill export/);
  assert.throws(() => parseImport('[]'), /not a Daily Drill export/);
  assert.doesNotThrow(() => parseImport(JSON.stringify({ attempts: [] })));
});

test('mergeState keeps both devices work and never loses the local side', () => {
  const local = { ...emptyState(), attempts: [at('l1', 'a', '2026-09-01T20:00:00Z')], session_dates: ['2026-09-01'] };
  const incoming = { ...emptyState(), attempts: [at('r1', 'b', '2026-09-02T20:00:00Z')], session_dates: ['2026-09-02'] };

  const merged = mergeState(local, incoming);
  assert.equal(merged.attempts.length, 2);
  assert.deepEqual(merged.session_dates, ['2026-09-01', '2026-09-02']);

  // importing the same file twice changes nothing
  assert.deepEqual(mergeState(merged, incoming).attempts, merged.attempts);
});

test('mergeState keeps local settings, so a remote device cannot switch on the work lane', () => {
  const local = { ...emptyState(), settings: { show_work_lane: false } };
  const incoming = { ...emptyState(), settings: { show_work_lane: true } };
  assert.equal(mergeState(local, incoming).settings.show_work_lane, false);
});

test('syncPayload never carries work-scoped attempts or captures off the device', () => {
  const state = {
    ...emptyState(),
    attempts: [
      at('a1', 'sql.join_types', '2026-09-01T20:00:00Z'),
      at('a2', 'internal.thing', '2026-09-01T21:00:00Z', { scope: 'work' }),
    ],
    captures: [{ id: 'c1', body: 'a literal work detail', status: 'new' }],
  };
  const payload = syncPayload(state);
  assert.equal(payload.attempts.length, 1);
  assert.equal(payload.attempts[0].id, 'a1');
  assert.equal('captures' in payload, false, 'captures never sync');
});
