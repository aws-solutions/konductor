'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib');

const R = path.join(__dirname, '..');
const SOLUTION = path.join(R, 'solution', 'docs', 'cutover.md');

function readSolution() {
  return readDecision(SOLUTION);
}

function readInputs() {
  const acceptance = JSON.parse(fs.readFileSync(path.join(R, 'fixture', 'acceptance.json'), 'utf8'));
  const price = JSON.parse(fs.readFileSync(path.join(R, 'fixture', 'price-sheet.json'), 'utf8'));
  const model = JSON.parse(fs.readFileSync(path.join(R, 'fixture', 'migration-model.json'), 'utf8'));
  const rows = fs.readFileSync(path.join(R, 'fixture', 'traffic-profile.csv'), 'utf8')
    .trim().split(/\r?\n/).slice(1).map((line) => line.split(','));
  const business = rows.find((row) => row[0] === 'business_hours');
  const offHours = rows.find((row) => row[0] === 'off_hours');
  return {
    acceptance,
    price,
    model,
    businessCap: Number(business[3]),
    latencyLimit: Number(business[4]),
    offHoursCap: Number(offHours[3])
  };
}

function optionCost(price, optionId) {
  return price.option_items[optionId]
    .reduce((sum, item) => sum + price.items[item], 0);
}

function optionMetrics(inputs, optionId) {
  const option = inputs.model.options[optionId];
  const throughput = option.throughput_source === 'business_hours_network_cap_mb_s'
    ? inputs.businessCap
    : inputs.offHoursCap;
  const downtime = option.copy_during_write_pause
    ? inputs.model.production_data_tb * inputs.model.decimal_mb_per_tb /
      inputs.model.off_hours_replication_mb_s / 60
    : Object.values(option.handoff_steps_min).reduce((sum, minutes) => sum + minutes, 0);
  return {
    downtime_min: downtime,
    rpo_min: option.rpo_min,
    latency_ms: option.latency_ms,
    throughput_mb_s: throughput,
    monthly_cost_usd: optionCost(inputs.price, optionId)
  };
}

function limitsFor(inputs) {
  return {
    downtime_min: inputs.acceptance.downtime_limit_min,
    rpo_min: inputs.acceptance.rpo_limit_min,
    latency_ms: inputs.latencyLimit,
    throughput_mb_s: inputs.businessCap,
    monthly_cost_usd: inputs.price.monthly_budget_usd
  };
}

function assertReportedValue(decision, name, expected) {
  assert.ok(decision.limits[name], `missing ${name}`);
  assert.ok(near(decision.limits[name].value, expected, 0.1), `${name} value is not close to ${expected}`);
}

test('cutover deliverable exists', () => {
  const decision = readSolution();
  assert.equal(typeof decision, 'object');
  assert.ok(fs.statSync(SOLUTION).isFile());
});

test('decision block parses as an object', () => {
  const decision = readSolution();
  assert.equal(Array.isArray(decision), false);
  assert.equal(typeof decision.chosen, 'string');
});

test('decision block has exactly the required top-level keys', () => {
  const decision = readSolution();
  assert.deepEqual(Object.keys(decision).sort(), [
    'chosen', 'limits', 'monthly_cost_usd', 'options'
  ]);
});

test('chosen option is the accepted option and not the tempting option', () => {
  const decision = readSolution();
  const meta = JSON.parse(fs.readFileSync(path.join(R, 'meta.json'), 'utf8'));
  assert.ok(meta.acceptableOptions.includes(decision.chosen));
  assert.notEqual(decision.chosen, meta.temptyingOption || meta.temptingOption);
});

test('options lists every option id from the model', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assert.deepEqual([...decision.options].sort(), Object.keys(inputs.model.options).sort());
});

test('options contains no duplicate ids', () => {
  const decision = readSolution();
  assert.equal(new Set(decision.options).size, decision.options.length);
});

test('chosen option has a price-sheet entry', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assert.ok(Array.isArray(inputs.price.option_items[decision.chosen]));
});

test('reported monthly cost matches the chosen price-sheet items', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const expected = optionCost(inputs.price, decision.chosen);
  assert.ok(near(decision.monthly_cost_usd, expected, 0.1));
});

test('reported downtime matches the chosen option calculation', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assertReportedValue(decision, 'downtime_min', optionMetrics(inputs, decision.chosen).downtime_min);
});

test('reported recovery point matches the chosen option data', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assertReportedValue(decision, 'rpo_min', optionMetrics(inputs, decision.chosen).rpo_min);
});

test('reported latency matches the chosen option data', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assertReportedValue(decision, 'latency_ms', optionMetrics(inputs, decision.chosen).latency_ms);
});

test('reported throughput matches the selected traffic profile', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assertReportedValue(decision, 'throughput_mb_s', optionMetrics(inputs, decision.chosen).throughput_mb_s);
});

test('limits contains every hard-limit name from the inputs', () => {
  const decision = readSolution();
  const inputs = readInputs();
  assert.deepEqual(Object.keys(decision.limits).sort(), Object.keys(limitsFor(inputs)).sort());
});

test('downtime limit is stated correctly and obeyed', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const limits = limitsFor(inputs);
  assert.ok(meets(decision.limits, 'downtime_min', limits.downtime_min, 'max'));
});

test('recovery point limit is stated correctly and obeyed', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const limits = limitsFor(inputs);
  assert.ok(meets(decision.limits, 'rpo_min', limits.rpo_min, 'max'));
});

test('latency limit is stated correctly and obeyed', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const limits = limitsFor(inputs);
  assert.ok(meets(decision.limits, 'latency_ms', limits.latency_ms, 'max'));
});

test('throughput limit is stated correctly and met', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const limits = limitsFor(inputs);
  assert.ok(meets(decision.limits, 'throughput_mb_s', limits.throughput_mb_s, 'min'));
});

test('monthly cost limit reports the chosen cost and obeys the budget', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const limits = limitsFor(inputs);
  assertReportedValue(decision, 'monthly_cost_usd', optionMetrics(inputs, decision.chosen).monthly_cost_usd);
  assert.ok(meets(decision.limits, 'monthly_cost_usd', limits.monthly_cost_usd, 'max'));
});

test('big-bang option breaks exactly the downtime limit', () => {
  const decision = readSolution();
  const inputs = readInputs();
  const limits = limitsFor(inputs);
  const metrics = optionMetrics(inputs, 'big_bang_copy');
  const failures = Object.entries(limits).filter(([name, limit]) => {
    const value = metrics[name];
    const direction = inputs.acceptance.directions[name];
    return direction === 'min' ? value < limit : value > limit;
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0][0], 'downtime_min');
});
