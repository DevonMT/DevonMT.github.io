const fs = require('fs');
const p = process.argv[2];
const c = JSON.parse(fs.readFileSync(p, 'utf8'));

if (!Array.isArray(c)) { console.log('FAIL: not an array'); process.exit(1); }

const ids = new Set();
const dupes = [];
const byDomain = {};
const byTier = {};
const badFields = [];

for (const x of c) {
  if (ids.has(x.id)) dupes.push(x.id);
  ids.add(x.id);
  byDomain[x.domain] = (byDomain[x.domain] || 0) + 1;
  byTier[x.tier] = (byTier[x.tier] || 0) + 1;
  for (const f of ['id', 'name', 'domain', 'tier', 'prereqs', 'notes']) {
    if (!(f in x)) badFields.push(x.id + ' missing ' + f);
  }
  if (![1, 2, 3].includes(x.tier)) badFields.push(x.id + ' bad tier');
  if (!Array.isArray(x.prereqs)) badFields.push(x.id + ' prereqs not array');
}

const dangling = [];
for (const x of c) for (const r of x.prereqs || []) if (!ids.has(r)) dangling.push(x.id + ' -> ' + r);

// cross-domain prereq edges (allowed, but worth seeing)
const domainOf = Object.fromEntries(c.map(x => [x.id, x.domain]));
const crossEdges = [];
for (const x of c) for (const r of x.prereqs || []) if (domainOf[r] && domainOf[r] !== x.domain) crossEdges.push(x.id + ' <- ' + r);

// prereq cycle check
const state = {};
const cycles = [];
const byId = Object.fromEntries(c.map(x => [x.id, x]));
function visit(id, stack) {
  if (state[id] === 2) return;
  if (state[id] === 1) { cycles.push(stack.slice(stack.indexOf(id)).join(' -> ') + ' -> ' + id); return; }
  state[id] = 1;
  for (const r of (byId[id] && byId[id].prereqs) || []) if (byId[r]) visit(r, stack.concat(id));
  state[id] = 2;
}
for (const x of c) visit(x.id, []);

console.log('total concepts:', c.length);
console.log('by domain:', JSON.stringify(byDomain));
console.log('by tier:', JSON.stringify(byTier));
console.log('duplicate ids:', dupes.length ? dupes : 'none');
console.log('field problems:', badFields.length ? badFields : 'none');
console.log('dangling prereqs:', dangling.length ? dangling : 'none');
console.log('prereq cycles:', cycles.length ? cycles : 'none');
console.log('cross-domain prereq edges:', crossEdges.length);
crossEdges.forEach(e => console.log('   ', e));

const specRefs = ['sql.window.frame_clause', 'modeling.scd_type2', 'pipelines.idempotency', 'orchestration.backfill_semantics', 'comms.explaining_tradeoffs', 'sql.window.basics'];
console.log('spec example ids present:', specRefs.map(i => i + '=' + ids.has(i)).join(', '));
