'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib');

const root = path.join(__dirname, '..');
const fixture = path.join(root, 'fixture');
const deliverable = path.join(root, 'solution', 'docs', 'architecture.md');

function csvObject(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const headers = rows.shift().split(',');
  return Object.fromEntries(rows.map(row => {
    const values = row.split(',');
    return [values[0], Number(values[1])];
  }));
}

function sourceData() {
  const traffic = csvObject(path.join(fixture, 'traffic.csv'));
  const prices = JSON.parse(fs.readFileSync(path.join(fixture, 'price-sheet.json'), 'utf8'));
  const limits = JSON.parse(fs.readFileSync(path.join(fixture, 'requirements-limits.json'), 'utf8'));
  const service = JSON.parse(fs.readFileSync(path.join(fixture, 'service-limits.json'), 'utf8'));
  const options = JSON.parse(fs.readFileSync(path.join(fixture, 'options.json'), 'utf8'));
  return { traffic, prices, limits, service, options };
}

function decision() {
  return readDecision(deliverable);
}

function expectedCost(optionId) {
  const { traffic: t, prices: p, options } = sourceData();
  const o = options[optionId];
  const messages = (t.peak_ingress * t.peak_hours_per_day * 3600
    + t.baseline_ingress * t.baseline_hours_per_day * 3600) * t.month_days;
  const payloadGb = messages * t.payload_size / p.gb_definition;
  return messages / 1e6 * o.request_units_per_message * p.queue_request_usd_per_million
    + payloadGb * o.transfer_multiplier * p.transfer_usd_per_gb
    + o.worker_count * p.month_hours * p.worker_usd_per_hour;
}

test('architecture deliverable exists at the requested path', () => {
  assert.equal(fs.existsSync(deliverable), true);
});

test('decision block is parseable JSON', () => {
  assert.equal(typeof decision(), 'object');
});

test('decision has exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('chosen option is present in the fixture option catalog', () => {
  const { options } = sourceData();
  assert.equal(Object.hasOwn(options, decision().chosen), true);
});

test('chosen option is an acceptable non-single-queue design', () => {
  assert.notEqual(decision().chosen, 'single-queue-pool');
  assert.ok(['topic-regional-queues', 'stream-partitions'].includes(decision().chosen));
});

test('options lists every candidate option id', () => {
  const { options } = sourceData();
  assert.deepEqual(new Set(decision().options), new Set(Object.keys(options)));
});

test('reported monthly cost matches the chosen option calculation', () => {
  assert.equal(near(decision().monthly_cost_usd, expectedCost(decision().chosen), 0.1), true);
});

test('monthly cost is a finite positive number', () => {
  assert.equal(typeof decision().monthly_cost_usd, 'number');
  assert.equal(Number.isFinite(decision().monthly_cost_usd), true);
  assert.ok(decision().monthly_cost_usd > 0);
});

test('throughput limit is derived and satisfied', () => {
  const { traffic: t, service, options } = sourceData();
  const o = options[decision().chosen];
  const expected = t.peak_ingress;
  const capacity = o.capacity_per_partition_messages_per_second
    ? o.queue_count * o.capacity_per_partition_messages_per_second
    : o.queue_count * service.queue_capacity_messages_per_second;
  assert.equal(near(decision().limits.throughput_msg_s.value, capacity, 0.1), true);
  assert.equal(meets(decision().limits, 'throughput_msg_s', expected, 'min'), true);
  assert.equal(service.queue_capacity_messages_per_second > 0, true);
});

test('p99 delivery limit is reported and satisfied', () => {
  const { limits, options } = sourceData();
  const value = options[decision().chosen].p99_delivery_seconds;
  assert.equal(near(decision().limits.p99_delivery_seconds.value, value, 0.1), true);
  assert.equal(meets(decision().limits, 'p99_delivery_seconds', limits.p99_delivery_seconds, 'max'), true);
});

test('monthly budget limit is reported and satisfied', () => {
  const { limits } = sourceData();
  assert.equal(meets(decision().limits, 'monthly_budget_usd', limits.monthly_budget_usd, 'max'), true);
  assert.equal(near(decision().limits.monthly_budget_usd.value, decision().monthly_cost_usd, 0.1), true);
});

test('payload size limit is reported and satisfied', () => {
  const { traffic: t } = sourceData();
  assert.equal(near(decision().limits.payload_bytes.value, t.payload_size, 0.1), true);
  assert.equal(meets(decision().limits, 'payload_bytes', t.payload_size, 'max'), true);
});

test('recovery point limit is reported and satisfied', () => {
  const { limits, options } = sourceData();
  const value = options[decision().chosen].rpo_seconds;
  assert.equal(near(decision().limits.rpo_seconds.value, value, 0.1), true);
  assert.equal(meets(decision().limits, 'rpo_seconds', limits.rpo_seconds, 'max'), true);
});

test('recovery time limit is reported and satisfied', () => {
  const { limits, options } = sourceData();
  const value = options[decision().chosen].rto_minutes;
  assert.equal(near(decision().limits.rto_minutes.value, value, 0.1), true);
  assert.equal(meets(decision().limits, 'rto_minutes', limits.rto_minutes, 'max'), true);
});

test('limits contains exactly the six hard-limit names', () => {
  assert.deepEqual(Object.keys(decision().limits).sort(), [
    'monthly_budget_usd', 'p99_delivery_seconds', 'payload_bytes',
    'rpo_seconds', 'rto_minutes', 'throughput_msg_s'
  ]);
});

test('every limit entry contains only a numeric limit and value', () => {
  for (const entry of Object.values(decision().limits)) {
    assert.deepEqual(Object.keys(entry).sort(), ['limit', 'value']);
    assert.equal(typeof entry.limit, 'number');
    assert.equal(typeof entry.value, 'number');
  }
});

test('chosen capacity uses the production per-queue quota rather than the sandbox figure', () => {
  const { service, options } = sourceData();
  const capacity = options[decision().chosen].capacity_per_partition_messages_per_second
    ? options[decision().chosen].queue_count * options[decision().chosen].capacity_per_partition_messages_per_second
    : options[decision().chosen].queue_count * service.queue_capacity_messages_per_second;
  assert.ok(service.queue_capacity_messages_per_second > 0);
  assert.ok(capacity >= sourceData().traffic.peak_ingress);
});
