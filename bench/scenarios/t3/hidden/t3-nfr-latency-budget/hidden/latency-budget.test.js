'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib');

const R = path.join(__dirname, '..');
const solutionFile = path.join(R, 'solution', 'docs', 'latency.md');
const fixture = (name) => path.join(R, 'fixture', name);
const readJson = (name) => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));
const limits = readJson('limits.json');
const optionsData = readJson('architecture-options.json');
const prices = readJson('price-sheet.json');
const traffic = readJson('traffic.json');

function decision() {
  return readDecision(solutionFile);
}

function selectedOption() {
  const d = decision();
  const option = optionsData.options.find((item) => item.id === d.chosen);
  assert.ok(option, `unknown selected option: ${d.chosen}`);
  return option;
}

function latencyRows() {
  return fs.readFileSync(fixture('service-latencies.csv'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [service, p99] = line.split(',');
      return { service: service.trim(), p99: Number(p99) };
    });
}

function computedLatency(option) {
  const rows = Object.fromEntries(latencyRows().map((row) => [row.service, row.p99]));
  let pricing = rows.pricing;
  if (option.pricing_mode === 'cached') {
    pricing = prices.items.find((item) => item.id === 'pricing-cache').cached_pricing_p99_ms;
  }
  if (option.execution === 'serial') {
    return rows.gateway + rows.auth + pricing + rows.inventory + rows.payment;
  }
  return rows.gateway + rows.auth + Math.max(pricing, rows.inventory) + rows.payment;
}

function computedMonthlyCost(option) {
  const base = prices.items.find((item) => item.id === 'checkout-platform').monthly_usd;
  const recurring = prices.items.find((item) => item.id === option.recurring_item).monthly_usd;
  return base + recurring;
}

test('latency decision document exists', () => {
  assert.ok(fs.existsSync(solutionFile));
});

test('latency decision block parses as JSON', () => {
  assert.equal(typeof decision(), 'object');
});

test('decision JSON has exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), [
    'chosen', 'limits', 'monthly_cost_usd', 'options'
  ].sort());
});

test('chosen option is acceptable and is not the tempting serial option', () => {
  const d = decision();
  assert.equal(d.chosen, 'parallelize-pricing-inventory');
  assert.notEqual(d.chosen, 'keep-serial');
});

test('options is a nonempty list of known option ids', () => {
  const d = decision();
  assert.ok(Array.isArray(d.options));
  assert.ok(d.options.length > 0);
  const known = new Set(optionsData.options.map((item) => item.id));
  for (const id of d.options) assert.ok(known.has(id), `unknown option ${id}`);
});

test('chosen option appears in the considered options', () => {
  const d = decision();
  assert.ok(d.options.includes(d.chosen));
});

test('monthly cost is recomputed from the price sheet', () => {
  const d = decision();
  const expected = computedMonthlyCost(selectedOption());
  assert.ok(near(d.monthly_cost_usd, expected), `${d.monthly_cost_usd} is not near ${expected}`);
});

test('end-to-end p99 is recomputed from hop measurements and execution mode', () => {
  const d = decision();
  const expected = computedLatency(selectedOption());
  assert.ok(near(d.limits.end_to_end_p99_ms.value, expected), `${d.limits.end_to_end_p99_ms.value} is not near ${expected}`);
});

test('throughput value comes from the selected option capacity', () => {
  const d = decision();
  assert.ok(near(d.limits.throughput_rps.value, selectedOption().capacity_rps));
});

test('payload value comes from the selected option and traffic profile', () => {
  const d = decision();
  assert.ok(near(d.limits.payload_kb.value, Math.min(selectedOption().payload_kb, traffic.largest_checkout_request_kb)));
});

test('RPO value comes from the selected option', () => {
  const d = decision();
  assert.ok(near(d.limits.rpo_seconds.value, selectedOption().rpo_seconds));
});

test('RTO value comes from the selected option', () => {
  const d = decision();
  assert.ok(near(d.limits.rto_minutes.value, selectedOption().rto_minutes));
});

test('every hard-limit name is present in the decision', () => {
  const d = decision();
  for (const name of Object.keys(limits)) assert.ok(d.limits && d.limits[name], `missing ${name}`);
});

test('every reported limit number matches the fixture limit', () => {
  const d = decision();
  for (const [name, rule] of Object.entries(limits)) assert.equal(d.limits[name].limit, rule.limit, name);
});

test('reported latency obeys its maximum', () => {
  assert.ok(meets(decision().limits, 'end_to_end_p99_ms', limits.end_to_end_p99_ms.limit));
});

test('reported throughput obeys its minimum', () => {
  assert.ok(meets(decision().limits, 'throughput_rps', limits.throughput_rps.limit, 'min'));
});

test('reported monthly cost obeys its maximum', () => {
  assert.ok(meets(decision().limits, 'monthly_cost_usd', limits.monthly_cost_usd.limit));
});

test('reported payload obeys its maximum', () => {
  assert.ok(meets(decision().limits, 'payload_kb', limits.payload_kb.limit));
});

test('reported recovery targets obey both maximums', () => {
  const d = decision();
  assert.ok(meets(d.limits, 'rpo_seconds', limits.rpo_seconds.limit));
  assert.ok(meets(d.limits, 'rto_minutes', limits.rto_minutes.limit));
});

test('decision limit cost agrees with the standalone cost field', () => {
  assert.equal(decision().limits.monthly_cost_usd.value, decision().monthly_cost_usd);
});
