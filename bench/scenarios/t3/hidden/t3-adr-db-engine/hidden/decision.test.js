'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib');

const root = path.join(__dirname, '..');
const fixture = path.join(root, 'fixture');
const deliverable = path.join(root, 'solution', 'docs', 'adr', '0001-database.md');
const requirements = JSON.parse(fs.readFileSync(path.join(fixture, 'requirements.json'), 'utf8'));
const traffic = JSON.parse(fs.readFileSync(path.join(fixture, 'traffic-profile.json'), 'utf8'));
const recovery = JSON.parse(fs.readFileSync(path.join(fixture, 'recovery.json'), 'utf8'));
const platform = JSON.parse(fs.readFileSync(path.join(fixture, 'platform-limits.json'), 'utf8'));
const prices = JSON.parse(fs.readFileSync(path.join(fixture, 'price-sheet.json'), 'utf8'));

const acceptable = ['kv-provisioned-autoscaling'];
const tempting = 'kv-on-demand';
const optionIds = Object.keys(prices.options);

function hotPartitionCount() {
  return traffic.active_logical_keys * traffic.top_key_fraction / traffic.hot_keys_per_storage_partition;
}

function commonMonthlyCost() {
  return prices.common_monthly.storage_gb * prices.prices.storage_gb_month +
    prices.common_monthly.backup_gb * prices.prices.backup_gb_month;
}

function monthlyCost(optionId) {
  const option = prices.options[optionId];
  const p = prices.prices;
  const b = prices.billing;
  let variable;
  if (optionId === 'kv-on-demand') {
    const hours = b.hours_per_month;
    const seconds = hours * b.seconds_per_hour;
    variable = (traffic.average_writes_per_second * seconds / b.million_units) * p.on_demand_write_per_million +
      (traffic.average_reads_per_second * seconds / b.million_units) * p.on_demand_read_per_million;
  } else if (optionId === 'kv-provisioned-autoscaling') {
    const wcuHours = option.steady_wcu * option.steady_hours + option.launch_wcu * option.launch_hours;
    const rcuHours = option.steady_rcu * b.hours_per_month;
    variable = wcuHours * p.provisioned_wcu_hour + rcuHours * p.provisioned_rcu_hour;
  } else if (optionId === 'relational-cluster') {
    variable = option.nodes * b.hours_per_month * p.relational_node_hour;
  } else {
    throw new Error(`unknown option ${optionId}`);
  }
  return variable + commonMonthlyCost();
}

function derived(optionId) {
  const option = prices.options[optionId];
  const hotWrites = traffic.peak_writes_per_second * traffic.hot_key_fraction;
  return {
    peak_write_wps: option.peak_write_capacity_wps,
    read_p99_ms: option.read_latency_base_ms + option.hot_read_penalty_ms,
    monthly_budget_usd: monthlyCost(optionId),
    item_size_bytes: traffic.item_size_bytes,
    rpo_seconds: option.replication_interval_seconds,
    rto_seconds: option.recovery_minutes * 60,
    partition_write_wcu: hotWrites / hotPartitionCount() / option.write_distribution_shards
  };
}

function expectedLimits(optionId) {
  const values = derived(optionId);
  return {
    peak_write_wps: { limit: traffic.peak_writes_per_second, value: values.peak_write_wps, dir: 'min' },
    read_p99_ms: { limit: requirements.service_objectives.read_p99_max_ms, value: values.read_p99_ms, dir: 'max' },
    monthly_budget_usd: { limit: requirements.service_objectives.monthly_budget_usd, value: values.monthly_budget_usd, dir: 'max' },
    item_size_bytes: { limit: requirements.service_objectives.max_item_size_bytes, value: values.item_size_bytes, dir: 'max' },
    rpo_seconds: { limit: recovery.recovery_objectives.rpo_max_seconds, value: values.rpo_seconds, dir: 'max' },
    rto_seconds: { limit: recovery.recovery_objectives.rto_max_seconds, value: values.rto_seconds, dir: 'max' },
    partition_write_wcu: { limit: platform.key_value_service_limits.max_wcu_per_storage_partition_per_second, value: values.partition_write_wcu, dir: 'max' }
  };
}

function decision() {
  return readDecision(deliverable);
}

test('ADR deliverable exists at the requested path', () => {
  assert.equal(fs.existsSync(deliverable), true);
});

test('ADR contains a parseable decision block', () => {
  assert.equal(typeof decision(), 'object');
});

test('decision JSON has exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('chosen option is an accepted option id', () => {
  assert.equal(acceptable.includes(decision().chosen), true);
});

test('chosen option is not the tempting on-demand option', () => {
  assert.notEqual(decision().chosen, tempting);
});

test('options lists every available option exactly once', () => {
  assert.deepEqual([...decision().options].sort(), [...optionIds].sort());
  assert.equal(new Set(decision().options).size, optionIds.length);
});

test('reported monthly cost matches the price-sheet calculation', () => {
  assert.equal(near(decision().monthly_cost_usd, monthlyCost(decision().chosen), 0.1), true);
});

test('decision reports every hard limit', () => {
  assert.deepEqual(Object.keys(decision().limits).sort(), Object.keys(expectedLimits(decision().chosen)).sort());
});

test('each reported limit has numeric limit and value fields', () => {
  for (const entry of Object.values(decision().limits)) {
    assert.equal(typeof entry.limit, 'number');
    assert.equal(typeof entry.value, 'number');
    assert.equal(Number.isFinite(entry.limit), true);
    assert.equal(Number.isFinite(entry.value), true);
  }
});

test('reported hard-limit numbers match fixture-derived limits', () => {
  const actual = decision().limits;
  for (const [name, expected] of Object.entries(expectedLimits(decision().chosen))) {
    assert.equal(actual[name].limit, expected.limit, name);
    assert.equal(near(actual[name].value, expected.value, 0.1), true, name);
  }
});

test('chosen write capacity meets the launch throughput target', () => {
  const e = expectedLimits(decision().chosen).peak_write_wps;
  assert.equal(meets(decision().limits, 'peak_write_wps', e.limit, e.dir), true);
});

test('chosen read p99 meets the latency target', () => {
  const e = expectedLimits(decision().chosen).read_p99_ms;
  assert.equal(meets(decision().limits, 'read_p99_ms', e.limit, e.dir), true);
});

test('chosen monthly cost stays within budget', () => {
  const e = expectedLimits(decision().chosen).monthly_budget_usd;
  assert.equal(meets(decision().limits, 'monthly_budget_usd', e.limit, e.dir), true);
});

test('chosen item size meets the item-size target', () => {
  const e = expectedLimits(decision().chosen).item_size_bytes;
  assert.equal(meets(decision().limits, 'item_size_bytes', e.limit, e.dir), true);
});

test('chosen recovery point meets the RPO target', () => {
  const e = expectedLimits(decision().chosen).rpo_seconds;
  assert.equal(meets(decision().limits, 'rpo_seconds', e.limit, e.dir), true);
});

test('chosen recovery time meets the RTO target', () => {
  const e = expectedLimits(decision().chosen).rto_seconds;
  assert.equal(meets(decision().limits, 'rto_seconds', e.limit, e.dir), true);
});

test('chosen hot-partition write rate stays under the service ceiling', () => {
  const e = expectedLimits(decision().chosen).partition_write_wcu;
  assert.equal(meets(decision().limits, 'partition_write_wcu', e.limit, e.dir), true);
});

test('tempting on-demand option exceeds exactly one hard limit', () => {
  const expected = expectedLimits(tempting);
  const failures = Object.values(expected).filter((e) => {
    return e.dir === 'min' ? e.value < e.limit : e.value > e.limit;
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0], expected.partition_write_wcu);
  assert.equal(expected.partition_write_wcu.value > expected.partition_write_wcu.limit, true);
});
