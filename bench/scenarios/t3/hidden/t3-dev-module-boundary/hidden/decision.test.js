'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readDecision, near, meets } = require('./decision-lib');

const R = path.join(__dirname, '..');
const fixture = name => path.join(R, 'fixture', name);
const solution = name => path.join(R, 'solution', name);
const readJson = name => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));
const runtime = readJson('runtime-limits.json');
const traffic = readJson('traffic.json');
const reliability = readJson('reliability.json');
const budget = readJson('operations-budget.json');
const prices = readJson('pricing.json');
const matrix = readJson('option-matrix.json').options;
const meta = JSON.parse(fs.readFileSync(path.join(R, 'meta.json'), 'utf8'));
const designPath = solution('docs/design.md');

function loadDecision() {
  return readDecision(designPath);
}

function expectedMemory(option) {
  return option.base_memory_mb + (option.batch_records * traffic.payload_kb) / 1000;
}

function expectedCost(id) {
  const option = matrix[id];
  if (option.billing_model === 'in_memory') {
    return prices.in_memory_delay_queue.fixed_monthly_usd;
  }
  if (option.billing_model === 'database_retry_table') {
    const p = prices.database_retry_table;
    return option.compute_units * p.compute_usd_per_unit
      + option.storage_gb * p.storage_usd_per_gb
      + option.backup_gb * p.backup_usd_per_gb
      + option.requests_million * p.request_usd_per_million;
  }
  if (option.billing_model === 'external_retry_queue') {
    const p = prices.external_retry_queue;
    return option.worker_units * p.worker_usd_per_unit
      + option.storage_gb * p.storage_usd_per_gb
      + option.requests_million * p.request_usd_per_million;
  }
  throw new Error(`unknown billing model for ${id}`);
}

function expectedLimits(id) {
  const option = matrix[id];
  return {
    memory_mb: { limit: runtime.retry_memory_limit_mb, value: expectedMemory(option), dir: 'max' },
    latency_p95_seconds: { limit: runtime.dispatch_latency_p95_seconds, value: option.latency_p95_seconds, dir: 'max' },
    throughput_per_second: { limit: runtime.dispatch_throughput_min_per_second, value: option.throughput_per_second, dir: 'min' },
    payload_kb: { limit: traffic.maximum_payload_kb, value: traffic.payload_kb, dir: 'max' },
    monthly_budget_usd: { limit: budget.monthly_budget_usd, value: expectedCost(id), dir: 'max' },
    rpo_minutes: { limit: reliability.retry_rpo_max_minutes, value: option.rpo_minutes, dir: 'max' },
    rto_minutes: { limit: reliability.service_rto_max_minutes, value: option.rto_minutes, dir: 'max' }
  };
}

test('ADR deliverable exists at the requested path', () => {
  assert.equal(fs.existsSync(designPath), true);
});

test('ADR contains a parseable decision block', () => {
  assert.doesNotThrow(() => loadDecision());
});

test('decision object has exactly the requested top-level keys', () => {
  assert.deepEqual(Object.keys(loadDecision()).sort(), [
    'chosen', 'limits', 'monthly_cost_usd', 'options'
  ]);
});

test('chosen option is acceptable', () => {
  assert.ok(meta.acceptableOptions.includes(loadDecision().chosen));
});

test('chosen option is not the tempting option', () => {
  assert.notEqual(loadDecision().chosen, meta.temptingOption);
});

test('options lists every available option exactly once', () => {
  const decision = loadDecision();
  assert.deepEqual([...new Set(decision.options)].sort(), Object.keys(matrix).sort());
});

test('options contains the chosen option', () => {
  const decision = loadDecision();
  assert.ok(decision.options.includes(decision.chosen));
});

test('limit entries cover exactly the hard limits', () => {
  assert.deepEqual(Object.keys(loadDecision().limits).sort(), Object.keys(expectedLimits(loadDecision().chosen)).sort());
});

test('memory value is recomputed from the chosen batch and payload', () => {
  const d = loadDecision();
  const expected = expectedLimits(d.chosen).memory_mb;
  assert.ok(near(d.limits.memory_mb.value, expected.value));
});

test('memory limit is the production retry allowance', () => {
  const d = loadDecision();
  assert.equal(d.limits.memory_mb.limit, runtime.retry_memory_limit_mb);
});

test('latency value comes from the selected option profile', () => {
  const d = loadDecision();
  assert.ok(near(d.limits.latency_p95_seconds.value, matrix[d.chosen].latency_p95_seconds));
});

test('throughput value comes from the selected option profile', () => {
  const d = loadDecision();
  assert.ok(near(d.limits.throughput_per_second.value, matrix[d.chosen].throughput_per_second));
});

test('payload value and limit come from the traffic profile', () => {
  const d = loadDecision();
  assert.equal(d.limits.payload_kb.value, traffic.payload_kb);
  assert.equal(d.limits.payload_kb.limit, traffic.maximum_payload_kb);
});

test('recovery limits and values come from reliability inputs', () => {
  const d = loadDecision();
  assert.equal(d.limits.rpo_minutes.limit, reliability.retry_rpo_max_minutes);
  assert.equal(d.limits.rto_minutes.limit, reliability.service_rto_max_minutes);
  assert.equal(d.limits.rpo_minutes.value, matrix[d.chosen].rpo_minutes);
  assert.equal(d.limits.rto_minutes.value, matrix[d.chosen].rto_minutes);
});

test('monthly cost is recomputed from the price sheet', () => {
  const d = loadDecision();
  assert.ok(near(d.monthly_cost_usd, expectedCost(d.chosen)));
});

test('monthly budget limit uses the operations budget input', () => {
  const d = loadDecision();
  assert.equal(d.limits.monthly_budget_usd.limit, budget.monthly_budget_usd);
  assert.ok(near(d.limits.monthly_budget_usd.value, expectedCost(d.chosen)));
});

test('reported throughput obeys its minimum', () => {
  const d = loadDecision();
  const e = expectedLimits(d.chosen).throughput_per_second;
  assert.equal(meets(d.limits, 'throughput_per_second', e.limit, e.dir), true);
});

test('every reported hard limit has the derived value and obeys its direction', () => {
  const d = loadDecision();
  const expected = expectedLimits(d.chosen);
  for (const [name, e] of Object.entries(expected)) {
    assert.ok(near(d.limits[name].value, e.value), `${name} value`);
    assert.equal(meets(d.limits, name, e.limit, e.dir), true, `${name} constraint`);
  }
});

test('tempting option calculation exceeds only the memory limit', () => {
  const expected = expectedLimits(meta.temptingOption);
  const failures = Object.values(expected).filter(e => e.dir === 'max'
    ? e.value > e.limit
    : e.value < e.limit);
  assert.deepEqual(failures.map(e => e.limit), [runtime.retry_memory_limit_mb]);
});
