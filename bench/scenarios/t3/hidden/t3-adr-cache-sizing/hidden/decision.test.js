'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readDecision, near, meets } = require('./decision-lib');

const R = path.join(__dirname, '..');
const fixture = name => path.join(R, 'fixture', name);
const solution = path.join(R, 'solution', 'docs', 'adr', '0001-cache.md');

function tableNumber(file, label) {
  const text = fs.readFileSync(file, 'utf8');
  const row = text.split(/\r?\n/).find(line => line.trim().startsWith(`| ${label} |`));
  assert.ok(row, `table row not found: ${label}`);
  const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
  const number = Number(cells[1].replace(/[^0-9.-]/g, ''));
  assert.ok(Number.isFinite(number), `table value is not numeric: ${label}`);
  return number;
}

function loadInputs() {
  const requirements = fixture('service-requirements.md');
  const traffic = fixture('traffic-profile.md');
  const operations = fixture('operating-model.md');
  const prices = JSON.parse(fs.readFileSync(fixture('price-sheet.json'), 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(fixture('candidate-configs.json'), 'utf8')).candidates;
  const benchmarkRows = fs.readFileSync(fixture('node-benchmarks.csv'), 'utf8')
    .trim().split(/\r?\n/).slice(1).map(line => {
      const [node_id, memory_gb, p95_latency_ms, primary_throughput_rps] = line.split(',');
      return { node_id, memory_gb: Number(memory_gb), p95_latency_ms: Number(p95_latency_ms), primary_throughput_rps: Number(primary_throughput_rps) };
    });
  const priceById = new Map(prices.nodes.map(node => [node.id, node]));
  const benchmarkById = new Map(benchmarkRows.map(row => [row.node_id, row]));
  const limits = {
    p95_latency_ms: tableNumber(requirements, 'p95 cache-read latency'),
    monthly_budget_usd: tableNumber(requirements, 'Monthly infrastructure spend'),
    rpo_minutes: tableNumber(requirements, 'Recovery point objective'),
    rto_minutes: tableNumber(requirements, 'Recovery time objective'),
    resident_hit_ratio_percent: tableNumber(requirements, 'In-memory hit-ratio floor'),
  };
  const peakWorkingSetGb = tableNumber(traffic, 'Working set, month-end peak');
  const requiredThroughputRps = tableNumber(traffic, 'Sustained cache reads');
  const reservationPercent = tableNumber(operations, 'Engine memory reservation');
  const rpoWithReplica = tableNumber(operations, 'RPO with a replica');
  const rtoWithReplica = tableNumber(operations, 'RTO with a replica');
  const rpoWithoutReplica = tableNumber(operations, 'RPO without a replica');
  const rtoWithoutReplica = tableNumber(operations, 'RTO without a replica');

  function calculate(candidate) {
    const price = priceById.get(candidate.node_id);
    const benchmark = benchmarkById.get(candidate.node_id);
    assert.ok(price && benchmark, `missing source row for ${candidate.node_id}`);
    const primaryNodes = candidate.shards;
    const nodeCount = candidate.shards * (candidate.replicas_per_shard + 1);
    const usablePrimaryMemory = primaryNodes * price.memory_gb * (1 - reservationPercent / 100);
    return {
      monthly_cost_usd: nodeCount * price.monthly_price_usd,
      p95_latency_ms: benchmark.p95_latency_ms,
      throughput_rps: primaryNodes * benchmark.primary_throughput_rps,
      resident_hit_ratio_percent: Math.min(100, usablePrimaryMemory / peakWorkingSetGb * 100),
      rpo_minutes: candidate.replicas_per_shard > 0 ? rpoWithReplica : rpoWithoutReplica,
      rto_minutes: candidate.replicas_per_shard > 0 ? rtoWithReplica : rtoWithoutReplica,
    };
  }

  return { candidates, limits, requiredThroughputRps, calculate };
}

function decision() {
  return readDecision(solution);
}

function metadata() {
  return JSON.parse(fs.readFileSync(path.join(R, 'meta.json'), 'utf8'));
}

function chosenInputs() {
  const inputs = loadInputs();
  const d = decision();
  const candidate = inputs.candidates.find(item => item.id === d.chosen);
  assert.ok(candidate, `unknown chosen candidate: ${d.chosen}`);
  return { ...inputs, d, candidate, actual: inputs.calculate(candidate) };
}

function expectedLimitKeys() {
  return ['p95_latency_ms', 'throughput_rps', 'resident_hit_ratio_percent', 'monthly_budget_usd', 'rpo_minutes', 'rto_minutes'];
}

function expectedLimit(name, inputs) {
  if (name === 'throughput_rps') return inputs.requiredThroughputRps;
  return inputs.limits[name];
}

function direction(name) {
  return name === 'throughput_rps' || name === 'resident_hit_ratio_percent' ? 'min' : 'max';
}

test('ADR deliverable exists at the requested path', () => {
  assert.ok(fs.existsSync(solution));
});

test('ADR contains a parseable decision block', () => {
  assert.deepEqual(typeof decision(), 'object');
});

test('decision block has exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('chosen option names an input candidate', () => {
  const { candidates, d } = chosenInputs();
  assert.ok(candidates.some(candidate => candidate.id === d.chosen));
});

test('chosen option is acceptable and not tempting', () => {
  const d = decision();
  assert.ok(metadata().acceptableOptions.includes(d.chosen));
  assert.notEqual(d.chosen, metadata().temptingOption);
});

test('chosen option satisfies every derived hard limit', () => {
  const { d, actual, limits, requiredThroughputRps } = chosenInputs();
  const values = { ...actual, monthly_budget_usd: actual.monthly_cost_usd };
  for (const name of expectedLimitKeys()) {
    assert.ok(meets(d.limits, name, expectedLimit(name, { limits, requiredThroughputRps }), direction(name)), name);
    assert.ok(near(d.limits[name].value, values[name]), `${name} value`);
  }
});

test('options is an array containing the chosen option', () => {
  const d = decision();
  assert.ok(Array.isArray(d.options));
  assert.ok(d.options.includes(d.chosen));
});

test('options include every candidate that meets all hard limits', () => {
  const { candidates, calculate, limits, requiredThroughputRps, d } = chosenInputs();
  const acceptable = candidates.filter(candidate => {
    const actual = calculate(candidate);
    const values = { ...actual, monthly_budget_usd: actual.monthly_cost_usd };
    return expectedLimitKeys().every(name => {
      const limit = expectedLimit(name, { limits, requiredThroughputRps });
      return direction(name) === 'min' ? values[name] >= limit : values[name] <= limit;
    });
  }).map(candidate => candidate.id);
  for (const id of acceptable) assert.ok(d.options.includes(id), `missing considered option ${id}`);
});

test('monthly cost matches node count and the price sheet', () => {
  const { d, actual } = chosenInputs();
  assert.ok(near(d.monthly_cost_usd, actual.monthly_cost_usd));
});

test('monthly cost is repeated accurately in the limit object', () => {
  const { d, actual, limits } = chosenInputs();
  assert.ok(d.limits.monthly_budget_usd);
  assert.equal(d.limits.monthly_budget_usd.limit, limits.monthly_budget_usd);
  assert.ok(near(d.limits.monthly_budget_usd.value, actual.monthly_cost_usd));
});

test('latency reports the chosen node benchmark and obeys its maximum', () => {
  const { d, actual, limits } = chosenInputs();
  assert.ok(meets(d.limits, 'p95_latency_ms', limits.p95_latency_ms, 'max'));
  assert.ok(near(d.limits.p95_latency_ms.value, actual.p95_latency_ms));
});

test('throughput aggregates primary shard benchmarks and obeys its minimum', () => {
  const { d, actual, requiredThroughputRps } = chosenInputs();
  assert.ok(meets(d.limits, 'throughput_rps', requiredThroughputRps, 'min'));
  assert.ok(near(d.limits.throughput_rps.value, actual.throughput_rps));
});

test('resident hit ratio accounts for engine reservation and peak data', () => {
  const { d, actual, limits } = chosenInputs();
  assert.ok(meets(d.limits, 'resident_hit_ratio_percent', limits.resident_hit_ratio_percent, 'min'));
  assert.ok(near(d.limits.resident_hit_ratio_percent.value, actual.resident_hit_ratio_percent));
});

test('monthly budget uses the requirements-table limit and is obeyed', () => {
  const { d, actual, limits } = chosenInputs();
  assert.equal(d.limits.monthly_budget_usd.limit, limits.monthly_budget_usd);
  assert.ok(d.limits.monthly_budget_usd.value <= limits.monthly_budget_usd);
  assert.ok(near(d.limits.monthly_budget_usd.value, actual.monthly_cost_usd));
});

test('replica topology provides the required recovery point objective', () => {
  const { d, actual, limits } = chosenInputs();
  assert.ok(meets(d.limits, 'rpo_minutes', limits.rpo_minutes, 'max'));
  assert.ok(near(d.limits.rpo_minutes.value, actual.rpo_minutes));
});

test('replica topology provides the required recovery time objective', () => {
  const { d, actual, limits } = chosenInputs();
  assert.ok(meets(d.limits, 'rto_minutes', limits.rto_minutes, 'max'));
  assert.ok(near(d.limits.rto_minutes.value, actual.rto_minutes));
});

test('every hard limit has the required numeric shape and no limit is omitted', () => {
  const { d } = chosenInputs();
  assert.deepEqual(Object.keys(d.limits).sort(), expectedLimitKeys().sort());
  for (const name of expectedLimitKeys()) {
    assert.equal(typeof d.limits[name].limit, 'number');
    assert.equal(typeof d.limits[name].value, 'number');
  }
});
