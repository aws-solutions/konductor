'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readDecision, near, meets } = require('./decision-lib');

const R = path.join(__dirname, '..');
const fixture = path.join(R, 'fixture');
const solution = path.join(R, 'solution', 'docs', 'adr', '0001-delivery.md');
const traffic = JSON.parse(fs.readFileSync(path.join(fixture, 'traffic.json'), 'utf8'));
const service = JSON.parse(fs.readFileSync(path.join(fixture, 'service-levels.json'), 'utf8'));
const prices = JSON.parse(fs.readFileSync(path.join(fixture, 'price-sheet.json'), 'utf8'));
const performance = fs.readFileSync(path.join(fixture, 'performance.csv'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const [option_id, p95_start_ms, sustained_throughput_gbps, rpo_minutes, rto_minutes] = line.split(',');
    return {
      option_id,
      p95_start_ms: Number(p95_start_ms),
      sustained_throughput_gbps: Number(sustained_throughput_gbps),
      rpo_minutes: Number(rpo_minutes),
      rto_minutes: Number(rto_minutes)
    };
  });
const performanceById = new Map(performance.map((row) => [row.option_id, row]));
const allOptionIds = Object.keys(prices.options);
const acceptableOptions = ['cdn-committed', 'cdn-payg'];
const temptingOption = 'object-direct';

function tieredEgress(optionId) {
  let remainingTb = traffic.monthly_delivery_tb;
  let total = 0;
  for (const tier of prices.tiered_egress[optionId]) {
    const tierTb = tier.tb === null ? remainingTb : Math.min(tier.tb, remainingTb);
    total += tierTb * prices.tb_to_gb * tier.rate_usd_per_gb;
    remainingTb -= tierTb;
    if (remainingTb <= 0) break;
  }
  return total;
}

function monthlyCost(optionId) {
  const option = prices.options[optionId];
  const egress = option.model === 'committed'
    ? option.commit_monthly_usd + Math.max(0, traffic.monthly_delivery_tb - option.commit_tb) * prices.tb_to_gb * option.overage_rate_usd_per_gb
    : tieredEgress(optionId);
  return egress + option.request_and_delivery_usd;
}

function decision() {
  return readDecision(solution);
}

function limitEntry(name) {
  const entry = decision().limits && decision().limits[name];
  assert.ok(entry, `missing limit entry: ${name}`);
  return entry;
}

test('parses a decision fenced block', () => {
  assert.equal(typeof decision(), 'object');
});

test('decision has exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('chosen option is an acceptable option', () => {
  assert.ok(acceptableOptions.includes(decision().chosen));
});

test('chosen option is not the tempting direct-origin option', () => {
  assert.notEqual(decision().chosen, temptingOption);
});

test('options lists exactly the fixture candidates', () => {
  assert.deepEqual([...decision().options].sort(), [...allOptionIds].sort());
});

test('monthly cost matches the selected price calculation', () => {
  assert.ok(near(decision().monthly_cost_usd, monthlyCost(decision().chosen)));
});

test('p95 limit entry reports the selected measurement and source limit', () => {
  const e = limitEntry('p95_start_ms');
  assert.equal(e.limit, service.p95_start_time_max_ms);
  assert.ok(near(e.value, performanceById.get(decision().chosen).p95_start_ms));
});

test('selected p95 start time obeys its maximum', () => {
  assert.ok(meets(decision().limits, 'p95_start_ms', service.p95_start_time_max_ms, 'max'));
});

test('throughput limit entry reports the selected measurement and source limit', () => {
  const e = limitEntry('sustained_throughput_gbps');
  assert.equal(e.limit, traffic.sustained_throughput_min_gbps);
  assert.ok(near(e.value, performanceById.get(decision().chosen).sustained_throughput_gbps));
});

test('selected sustained throughput obeys its minimum', () => {
  assert.ok(meets(decision().limits, 'sustained_throughput_gbps', traffic.sustained_throughput_min_gbps, 'min'));
});

test('monthly budget entry reports the source limit and selected cost', () => {
  const e = limitEntry('monthly_cost_usd');
  assert.equal(e.limit, service.monthly_budget_max_usd);
  assert.ok(near(e.value, monthlyCost(decision().chosen)));
});

test('selected monthly cost obeys the budget', () => {
  assert.ok(meets(decision().limits, 'monthly_cost_usd', service.monthly_budget_max_usd, 'max'));
});

test('data-size entry reports the forecast volume', () => {
  const e = limitEntry('data_size_tb');
  assert.equal(e.limit, traffic.monthly_delivery_tb);
  assert.ok(near(e.value, traffic.monthly_delivery_tb));
});

test('selected data size satisfies the forecast volume', () => {
  assert.ok(meets(decision().limits, 'data_size_tb', traffic.monthly_delivery_tb, 'min'));
});

test('RPO entry reports the selected measurement and source limit', () => {
  const e = limitEntry('rpo_minutes');
  assert.equal(e.limit, service.rpo_max_minutes);
  assert.ok(near(e.value, performanceById.get(decision().chosen).rpo_minutes));
});

test('selected RPO obeys its maximum', () => {
  assert.ok(meets(decision().limits, 'rpo_minutes', service.rpo_max_minutes, 'max'));
});

test('RTO entry reports the selected measurement and source limit', () => {
  const e = limitEntry('rto_minutes');
  assert.equal(e.limit, service.rto_max_minutes);
  assert.ok(near(e.value, performanceById.get(decision().chosen).rto_minutes));
});

test('selected RTO obeys its maximum', () => {
  assert.ok(meets(decision().limits, 'rto_minutes', service.rto_max_minutes, 'max'));
});
