'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { readDecision, near, meets } = require('./decision-lib');

const R = path.join(__dirname, '..');
const decisionFile = path.join(R, 'solution', 'docs', 'decision.md');
const fixture = name => path.join(R, 'fixture', name);
const json = name => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));
const acceptableOptions = ['shared-composite'];
const temptingOption = 'tenant-database-per-customer';

function decision() {
  return readDecision(decisionFile);
}

function selectedInputs() {
  const d = decision();
  const options = json('options.json');
  assert.ok(options[d.chosen], `unknown option ${d.chosen}`);
  return { d, option: options[d.chosen] };
}

function expectedMetrics() {
  const { d, option } = selectedInputs();
  const traffic = json('traffic.json');
  const shape = json('data-shape.json');
  const pricing = json('pricing.json');
  const levels = json('service-levels.json');
  const rows = shape.ticket_rows + shape.support_rows;
  const storedGb = rows * shape.bytes_per_row_including_indexes * option.storage_multiplier / 1e9;
  const cost = storedGb * pricing.storage_usd_per_gb_month
    + option.compute_units * pricing.compute_unit_usd_month
    + traffic.monthly_requests_millions * pricing.requests_usd_per_million
    + option.database_count * pricing.database_usd_month;
  return {
    d,
    option,
    traffic,
    shape,
    pricing,
    levels,
    storedGb,
    cost,
    latency: option.latency_components_ms.reduce((a, b) => a + b, 0),
    writeCapacity: option.compute_units * option.writes_per_compute_unit_qps
  };
}

test('decision block has exactly the required top-level keys', () => {
  const keys = Object.keys(decision()).sort();
  assert.deepEqual(keys, ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('chosen option is acceptable', () => {
  assert.ok(acceptableOptions.includes(decision().chosen));
});

test('chosen option is not the tempting operationally invalid option', () => {
  assert.notEqual(decision().chosen, temptingOption);
});

test('options list names both compared options', () => {
  const d = decision();
  assert.ok(d.options.includes('shared-composite'));
  assert.ok(d.options.includes('tenant-database-per-customer'));
});

test('monthly cost is recomputed from fixture prices', () => {
  const { d, cost } = expectedMetrics();
  assert.ok(near(d.monthly_cost_usd, cost));
});

test('lookup latency is recomputed and meets its limit', () => {
  const { d, latency, levels } = expectedMetrics();
  assert.ok(near(d.limits.lookup_p95_ms.value, latency));
  assert.ok(meets(d.limits, 'lookup_p95_ms', levels.lookup_p95_ms));
});

test('write capacity is recomputed and meets its minimum', () => {
  const { d, writeCapacity, traffic } = expectedMetrics();
  assert.ok(near(d.limits.write_capacity_qps.value, writeCapacity));
  assert.ok(meets(d.limits, 'write_capacity_qps', traffic.required_write_capacity_qps, 'min'));
});

test('stored footprint is recomputed and meets its limit', () => {
  const { d, storedGb, shape } = expectedMetrics();
  assert.ok(near(d.limits.stored_gb.value, storedGb));
  assert.ok(meets(d.limits, 'stored_gb', shape.max_stored_gb));
});

test('monthly cost limit is present and obeyed', () => {
  const { d, pricing, cost } = expectedMetrics();
  assert.ok(near(d.limits.monthly_cost_usd.value, cost));
  assert.ok(meets(d.limits, 'monthly_cost_usd', pricing.monthly_budget_usd));
});

test('recovery point limit is present and obeyed', () => {
  const { d, option, levels } = expectedMetrics();
  assert.ok(near(d.limits.rpo_seconds.value, option.rpo_seconds));
  assert.ok(meets(d.limits, 'rpo_seconds', levels.rpo_seconds));
});

test('recovery time limit is present and obeyed', () => {
  const { d, option, levels } = expectedMetrics();
  assert.ok(near(d.limits.rto_minutes.value, option.rto_minutes));
  assert.ok(meets(d.limits, 'rto_minutes', levels.rto_minutes));
});

test('logical database limit is present and obeyed', () => {
  const { d, option, levels } = expectedMetrics();
  assert.ok(near(d.limits.logical_databases.value, option.database_count));
  assert.ok(meets(d.limits, 'logical_databases', levels.max_logical_databases));
});
