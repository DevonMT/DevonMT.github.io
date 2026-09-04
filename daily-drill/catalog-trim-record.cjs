const fs = require('fs');
const path = process.argv[2];
const c = JSON.parse(fs.readFileSync(path, 'utf8'));

const DROP = new Set([
  // data / sql - narrow syntax reps and things covered by a neighbour
  'sql.distinct_smell', 'sql.pivot', 'sql.recursive_cte', 'sql.window.running_totals',
  'sql.dedup_latest_per_key', 'sql.coalesce_nullif', 'sql.union_all', 'sql.window.lag_lead',
  // data / perf - deep index internals, rarely the thing you must explain
  'perf.composite_index_order', 'perf.covering_index', 'perf.shuffle_and_skew',
  'perf.bad_plans', 'perf.sargability',
  // data / modeling
  'modeling.fact_types', 'modeling.bridge_tables', 'modeling.one_big_table', 'modeling.medallion_layers',
  // data / warehouse
  'warehouse.mpp', 'warehouse.table_formats', 'warehouse.clustering_keys',
  // data / pipelines + orchestration
  'pipelines.stream_windowing', 'pipelines.delivery_semantics', 'pipelines.cdc',
  'orchestration.assets_vs_tasks', 'orchestration.sensors_and_triggers',
  // data / quality
  'quality.alert_fatigue', 'quality.testing_transformations', 'quality.referential_integrity',
  // data / analytics + viz
  'analytics.funnels', 'analytics.ab_testing', 'analytics.outliers', 'analytics.selection_bias',
  'analytics.baselines', 'viz.small_multiples', 'viz.annotation', 'viz.color_encoding',
  // software
  'code.recursion', 'code.floating_point', 'code.text_encoding', 'code.race_conditions',
  'py.comprehensions', 'py.decorators', 'py.type_hints', 'py.dataframe_joins', 'py.gil',
  'git.recovery', 'git.branching_strategy',
  'testing.mocking_boundaries', 'testing.fixtures_and_determinism',
  'debug.reading_stack_traces',
  'craft.semver', 'craft.premature_abstraction', 'craft.technical_debt',
  'api.idempotent_methods', 'api.payload_design',
  // build
  'web.request_lifecycle', 'web.caching', 'web.event_delegation', 'web.es_modules',
  'web.responsive', 'web.cors',
  'storage.append_only_log',
  'srs.lapses', 'srs.type_rotation', 'srs.binge_isolation',
  'ux.externalized_memory', 'ux.non_punitive_feedback', 'ux.work_lane_separation', 'ux.offline_first',
  'llm.calibration_set', 'llm.distractor_quality', 'llm.api_shape', 'llm.structured_output',
  'llm.tokens_and_cost',
  // systems
  'linux.pipes_redirection', 'linux.systemd', 'linux.disk_pressure',
  'container.networking', 'container.resource_limits',
  'net.reverse_proxy', 'net.exposure',
  'ops.observability_signals', 'ops.slos', 'ops.reproducible_setup',
  'incident.oncall_reasoning',
  // comms
  'comms.channel_choice', 'comms.contradicting_a_belief', 'comms.stakeholder_map',
  'comms.competing_priorities', 'comms.running_a_meeting', 'comms.documentation',
  'comms.executive_summary',
]);

// prereqs that pointed at a dropped concept and need repointing rather than deletion
const REPOINT = {
  'srs.forgetting_rule': { 'srs.lapses': 'srs.sm2' },
  'warehouse.storage_compute': { 'warehouse.mpp': 'warehouse.columnar' },
};

const kept = c.filter(x => !DROP.has(x.id));
const keptIds = new Set(kept.map(x => x.id));

for (const x of kept) {
  const map = REPOINT[x.id] || {};
  x.prereqs = x.prereqs.map(r => map[r] || r).filter(r => keptIds.has(r));
}

// re-emit one concept per line, blank line between area groups
const area = id => id.split('.')[0];
const J = JSON.stringify;
const render = x => '  { "id": ' + J(x.id) + ', "name": ' + J(x.name) + ', "domain": ' + J(x.domain) +
  ', "tier": ' + x.tier + ', "prereqs": [' + x.prereqs.map(J).join(', ') + '], "notes": ' + J(x.notes) + ' }';

let out = '[\n';
kept.forEach((x, i) => {
  if (i > 0 && area(x.id) !== area(kept[i - 1].id)) out += '\n';
  out += render(x) + (i < kept.length - 1 ? ',' : '') + '\n';
});
out += ']\n';
fs.writeFileSync(path, out);

const byDomain = {};
for (const x of kept) byDomain[x.domain] = (byDomain[x.domain] || 0) + 1;
console.log('dropped:', c.length - kept.length, ' kept:', kept.length);
console.log('by domain:', JSON.stringify(byDomain));
