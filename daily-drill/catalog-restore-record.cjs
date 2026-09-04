const fs = require('fs');
const path = process.argv[2];
const c = JSON.parse(fs.readFileSync(path, 'utf8'));

// comms is first-class; it must not wait on a data concept to unlock (SPEC.md §7 step 4)
const CUT_EDGES = {
  'comms.communicating_uncertainty': ['analytics.significance'],
  'comms.metric_to_decision': ['analytics.metric_definition'],
};

// tier-3 restored from the trim: the reps where "used it" and "can explain it" diverge
const RESTORE = [
  ['perf.explain_plan', { id: 'perf.sargability', name: 'Sargable predicates', domain: 'data', tier: 3, prereqs: ['perf.index_basics'], notes: 'Knowing it means seeing that wrapping an indexed column in a function kills the index, and rewriting DATE(ts) = x as a range on ts.' }],
  ['perf.sargability', { id: 'perf.shuffle_and_skew', name: 'Shuffles, spills, and skew', domain: 'data', tier: 3, prereqs: ['warehouse.storage_compute'], notes: 'Knowing it means explaining that distributed joins move data between nodes, and that one hot key can leave a single worker doing all the work.' }],
  ['modeling.fact_grain', { id: 'modeling.fact_types', name: 'Transaction, periodic snapshot, accumulating snapshot', domain: 'data', tier: 3, prereqs: ['modeling.fact_grain'], notes: 'Knowing it means picking the right one for a given question, and explaining why a balance is not a transaction.' }],
  ['modeling.semantic_layer', { id: 'modeling.one_big_table', name: 'One big table vs star schema', domain: 'data', tier: 3, prereqs: ['modeling.star_schema'], notes: 'Knowing it means acknowledging columnar engines made OBT viable, and naming what you give up: reuse, governance, and a shared dimension definition.' }],
  ['warehouse.file_formats', { id: 'warehouse.table_formats', name: 'Table formats and the lakehouse', domain: 'data', tier: 3, prereqs: ['warehouse.file_formats'], notes: 'Knowing it means describing Iceberg or Delta as a metadata layer giving files ACID, schema evolution and time travel — what makes a lake behave like a table.' }],
  ['pipelines.idempotency', { id: 'pipelines.delivery_semantics', name: 'At-least-once, at-most-once, exactly-once', domain: 'data', tier: 3, prereqs: ['pipelines.idempotency'], notes: 'Knowing it means saying most systems give at-least-once, and that exactly-once is usually at-least-once plus a dedupe key.' }],
  ['pipelines.incremental_loads', { id: 'pipelines.cdc', name: 'Change data capture', domain: 'data', tier: 3, prereqs: ['pipelines.incremental_loads'], notes: 'Knowing it means contrasting log-based with query-based CDC, and saying log-based catches deletes and does not hammer the source.' }],
  ['orchestration.dags', { id: 'orchestration.assets_vs_tasks', name: 'Asset-oriented vs task-oriented orchestration', domain: 'data', tier: 3, prereqs: ['orchestration.dags'], notes: 'Knowing it means describing the shift from "run this step" to "this table should exist", and what it buys you at debug time.' }],
  ['quality.reconciliation', { id: 'quality.alert_fatigue', name: 'Alert fatigue in data quality', domain: 'data', tier: 3, prereqs: ['quality.volume_anomalies'], notes: 'Knowing it means arguing that an alert nobody acts on is worse than no alert, because it teaches the team to ignore the channel.' }],
  ['analytics.metric_definition', { id: 'analytics.selection_bias', name: 'Survivorship and selection bias', domain: 'data', tier: 3, prereqs: ['analytics.metric_definition'], notes: 'Knowing it means asking who is missing from the table, and what their absence does to the average.' }],
  ['analytics.significance', { id: 'analytics.ab_testing', name: 'A/B test fundamentals', domain: 'data', tier: 3, prereqs: ['analytics.significance'], notes: 'Knowing it means naming the randomization unit, the cost of peeking, multiple comparisons, and pre-registering the metric.' }],

  ['code.concurrency_basics', { id: 'code.race_conditions', name: 'Race conditions and shared state', domain: 'software', tier: 3, prereqs: ['code.concurrency_basics'], notes: 'Knowing it means describing a read-modify-write interleaving that loses an update, and naming the cheapest fix that actually works.' }],
  ['py.vectorization', { id: 'py.gil', name: 'The GIL', domain: 'software', tier: 3, prereqs: ['code.concurrency_basics'], notes: 'Knowing it means saying why threads help an I/O-bound extract but not a CPU-bound transform, and what to reach for instead.' }],
  ['git.commit_hygiene', { id: 'git.recovery', name: 'Recovering from a bad git state', domain: 'software', tier: 3, prereqs: ['git.rebase_vs_merge'], notes: 'Knowing it means reaching for reflog, and saying which of revert and reset is actually destructive and to whom.' }],
  ['testing.pyramid', { id: 'testing.mocking_boundaries', name: 'Where to mock', domain: 'software', tier: 3, prereqs: ['testing.pyramid'], notes: 'Knowing it means mocking at the system boundary, and recognizing an over-mocked test as asserting your assumptions back at you.' }],
  ['craft.refactoring_safety', { id: 'craft.premature_abstraction', name: 'Premature abstraction', domain: 'software', tier: 3, prereqs: ['craft.refactoring_safety'], notes: 'Knowing it means arguing that duplication is cheaper than the wrong abstraction, and waiting for the third instance.' }],

  ['web.fetch_json', { id: 'web.cors', name: 'CORS and same-origin policy', domain: 'build', tier: 3, prereqs: ['web.fetch_json'], notes: 'Knowing it means explaining why the browser blocks a cross-origin fetch and what headers the Worker must return in phase 2.' }],
  ['srs.concept_keyed_state', { id: 'srs.type_rotation', name: 'Choosing a question type at presentation time', domain: 'build', tier: 3, prereqs: ['srs.concept_keyed_state'], notes: 'Knowing it means picking a rendering not recently shown for that concept, so variety comes from the bank rather than the schedule.' }],
  ['srs.answered_at', { id: 'srs.binge_isolation', name: 'Keeping extra reps out of the schedule', domain: 'build', tier: 3, prereqs: ['srs.sm2'], notes: 'Knowing it means logging beyond-the-cap reps without updating intervals, so a 40-question binge does not build a backlog three days later.' }],
  ['ux.capture_friction', { id: 'ux.offline_first', name: 'Offline-first as a constraint', domain: 'build', tier: 3, prereqs: ['storage.localstorage'], notes: 'Knowing it means naming what offline-first rules out and what it makes free, rather than treating it as a nice-to-have.' }],
  ['llm.prompt_versioning', { id: 'llm.calibration_set', name: 'Calibration fixtures for grading drift', domain: 'build', tier: 3, prereqs: ['llm.prompt_versioning'], notes: 'Knowing it means keeping ~20 fixture answers with expected results, because persisting questions guards generation drift but not grading drift.' }],

  ['linux.cron', { id: 'linux.systemd', name: 'systemd services', domain: 'systems', tier: 3, prereqs: ['linux.processes'], notes: 'Knowing it means setting a restart policy, reading journalctl, and knowing what it takes to survive a reboot.' }],
  ['container.compose', { id: 'container.resource_limits', name: 'Memory limits and the OOM kill', domain: 'systems', tier: 3, prereqs: ['container.image_vs_container'], notes: 'Knowing it means recognizing a container killed with nothing in its own logs, and knowing where the real evidence is.' }],
  ['net.tls', { id: 'net.reverse_proxy', name: 'Reverse proxies', domain: 'systems', tier: 3, prereqs: ['net.ports'], notes: 'Knowing it means one public entrypoint terminating TLS and routing to internal services — the shape of a home server done properly.' }],
  ['ops.monitoring_vs_alerting', { id: 'ops.observability_signals', name: 'Logs, metrics, and traces', domain: 'systems', tier: 3, prereqs: ['ops.monitoring_vs_alerting'], notes: 'Knowing it means matching each to a question: metrics say whether it was slow, traces say where, logs say what happened.' }],

  ['comms.communicating_uncertainty', { id: 'comms.contradicting_a_belief', name: 'When the data contradicts a strongly held belief', domain: 'comms', tier: 3, prereqs: ['comms.communicating_uncertainty'], notes: 'Knowing it means checking your own work first, then presenting it as a question rather than a verdict.' }],
  ['comms.pushing_back', { id: 'comms.competing_priorities', name: 'Two stakeholders, one you', domain: 'comms', tier: 3, prereqs: ['comms.pushing_back'], notes: 'Knowing it means making the conflict visible to both rather than absorbing it silently, and treating escalation as a service.' }],
  ['comms.definition_of_done', { id: 'comms.stakeholder_map', name: 'Knowing who actually decides', domain: 'comms', tier: 3, prereqs: [], notes: 'Knowing it means separating the requester, the decision-maker and the person who will be blamed — often three different people.' }],
];

for (const [id, drop] of Object.entries(CUT_EDGES)) {
  const x = c.find(y => y.id === id);
  if (!x) throw new Error('cut-edge target missing: ' + id);
  const before = x.prereqs.length;
  x.prereqs = x.prereqs.filter(r => !drop.includes(r));
  if (x.prereqs.length === before) throw new Error('edge not found on ' + id);
}

for (const [anchor, concept] of RESTORE) {
  if (c.some(y => y.id === concept.id)) throw new Error('already present: ' + concept.id);
  const i = c.findIndex(y => y.id === anchor);
  if (i === -1) throw new Error('anchor missing: ' + anchor + ' (for ' + concept.id + ')');
  c.splice(i + 1, 0, concept);
}

const area = id => id.split('.')[0];
const J = JSON.stringify;
const render = x => '  { "id": ' + J(x.id) + ', "name": ' + J(x.name) + ', "domain": ' + J(x.domain) +
  ', "tier": ' + x.tier + ', "prereqs": [' + x.prereqs.map(J).join(', ') + '], "notes": ' + J(x.notes) + ' }';

let out = '[\n';
c.forEach((x, i) => {
  if (i > 0 && area(x.id) !== area(c[i - 1].id)) out += '\n';
  out += render(x) + (i < c.length - 1 ? ',' : '') + '\n';
});
out += ']\n';
fs.writeFileSync(path, out);

console.log('restored:', RESTORE.length, ' edges cut:', Object.values(CUT_EDGES).flat().length, ' total:', c.length);
