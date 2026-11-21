'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib');

const root = path.join(__dirname, '..');
const fixture = path.join(root, 'fixture');
const solution = path.join(root, 'solution');
const traffic = require(path.join(fixture, 'data', 'traffic.json'));
const gateway = require(path.join(fixture, 'data', 'gateway.json'));
const performance = require(path.join(fixture, 'data', 'performance.json'));
const reliability = require(path.join(fixture, 'data', 'reliability.json'));
const budget = require(path.join(fixture, 'data', 'budget.json'));
const optionData = require(path.join(fixture, 'data', 'options.json'));
const priceSheet = require(path.join(fixture, 'pricing', 'price-sheet.json'));
const metadata = require(path.join(root, 'meta.json'));
const limits = {
  max_request_body_bytes: { limit: gateway.production_max_body_bytes, direction: 'max' },
  p99_latency_ms: { limit: performance.production_p99_latency_ms, direction: 'max' },
  throughput_readings_per_second: { limit: traffic.active_devices / traffic.reading_interval_seconds, direction: 'min' },
  monthly_budget_usd: { limit: budget.production_monthly_budget_usd, direction: 'max' },
  rpo_seconds: { limit: reliability.production_rpo_seconds, direction: 'max' },
  rto_minutes: { limit: reliability.production_rto_minutes, direction: 'max' }
};
const decisionPath = path.join(solution, 'docs', 'decision.md');
const apiPath = path.join(solution, 'api', 'openapi.json');

function decision() {
  return readDecision(decisionPath);
}

function chosenOption() {
  const d = decision();
  assert.ok(optionData.options[d.chosen], `unknown option ${d.chosen}`);
  return optionData.options[d.chosen];
}

function monthlyCost(option) {
  return Object.entries(option.usage)
    .reduce((sum, [unit, quantity]) => sum + quantity * priceSheet.rates[unit], 0);
}

function bodyBytes(option) {
  return gateway.batch_envelope_bytes + option.max_items * traffic.reading_bytes;
}

function api() {
  return JSON.parse(fs.readFileSync(apiPath, 'utf8'));
}

test('decision block is present and parses as an object', () => {
  assert.equal(typeof decision(), 'object');
});

test('decision JSON has exactly the requested top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), [
    'chosen', 'limits', 'monthly_cost_usd', 'options'
  ]);
});

test('chosen option is acceptable and is not the tempting option', () => {
  const d = decision();
  assert.ok(metadata.acceptableOptions.includes(d.chosen));
  assert.notEqual(d.chosen, metadata.temptingOption);
});

test('decision lists every considered option exactly once', () => {
  const d = decision();
  assert.deepEqual([...new Set(d.options)].sort(), Object.keys(optionData.options).sort());
  assert.ok(d.options.includes(d.chosen));
});

test('monthly cost is recomputed from the selected usage and price sheet', () => {
  const d = decision();
  assert.ok(near(d.monthly_cost_usd, monthlyCost(chosenOption()), 0.1));
});

test('all fixture hard limits have the right limit numbers', () => {
  const reported = decision().limits;
  assert.deepEqual(Object.keys(reported).sort(), Object.keys(limits).sort());
  for (const [name, rule] of Object.entries(limits)) {
    assert.equal(reported[name].limit, rule.limit, name);
  }
});

test('request body value stays under the derived gateway limit', () => {
  const d = decision();
  assert.equal(d.limits.max_request_body_bytes.value, bodyBytes(chosenOption()));
  assert.ok(meets(d.limits, 'max_request_body_bytes', limits.max_request_body_bytes.limit, 'max'));
});

test('reported p99 latency is the selected option value and meets its limit', () => {
  const d = decision();
  assert.equal(d.limits.p99_latency_ms.value, chosenOption().p99_latency_ms);
  assert.ok(meets(d.limits, 'p99_latency_ms', limits.p99_latency_ms.limit, 'max'));
});

test('reported throughput is the selected option value and meets demand', () => {
  const d = decision();
  const demand = traffic.active_devices / traffic.reading_interval_seconds;
  assert.equal(d.limits.throughput_readings_per_second.value, chosenOption().throughput_readings_per_second);
  assert.equal(limits.throughput_readings_per_second.limit, demand);
  assert.ok(meets(d.limits, 'throughput_readings_per_second', limits.throughput_readings_per_second.limit, 'min'));
});

test('reported monthly cost value meets the budget limit', () => {
  const d = decision();
  assert.ok(near(d.limits.monthly_budget_usd.value, monthlyCost(chosenOption()), 0.1));
  assert.ok(meets(d.limits, 'monthly_budget_usd', limits.monthly_budget_usd.limit, 'max'));
});

test('reported recovery point meets the RPO limit', () => {
  const d = decision();
  assert.equal(d.limits.rpo_seconds.value, chosenOption().rpo_seconds);
  assert.ok(meets(d.limits, 'rpo_seconds', limits.rpo_seconds.limit, 'max'));
});

test('reported recovery time meets the RTO limit', () => {
  const d = decision();
  assert.equal(d.limits.rto_minutes.value, chosenOption().rto_minutes);
  assert.ok(meets(d.limits, 'rto_minutes', limits.rto_minutes.limit, 'max'));
});

test('tempting option is cheaper but violates only the body-size limit', () => {
  const tempting = optionData.options[metadata.temptingOption];
  const values = {
    max_request_body_bytes: bodyBytes(tempting),
    p99_latency_ms: tempting.p99_latency_ms,
    throughput_readings_per_second: tempting.throughput_readings_per_second,
    monthly_budget_usd: monthlyCost(tempting),
    rpo_seconds: tempting.rpo_seconds,
    rto_minutes: tempting.rto_minutes
  };
  const violations = Object.entries(limits)
    .filter(([name, rule]) => rule.direction === 'min'
      ? values[name] < rule.limit
      : values[name] > rule.limit)
    .map(([name]) => name);
  assert.deepEqual(violations, ['max_request_body_bytes']);
  assert.ok(monthlyCost(tempting) < monthlyCost(optionData.options['buffered-batch']));
});

test('OpenAPI document is valid JSON with paths and components', () => {
  const document = api();
  assert.match(document.openapi, /^3\./);
  assert.ok(document.paths && document.components && document.components.schemas);
});

test('batch ingest POST has a bounded readings array from the selected option', () => {
  const post = api().paths['/v1/ingest-batches'].post;
  assert.ok(post);
  const schema = post.requestBody.content['application/json'].schema;
  assert.equal(schema.properties.readings.type, 'array');
  assert.equal(schema.properties.readings.maxItems, chosenOption().max_items);
  assert.ok(schema.properties.readings.maxItems * traffic.reading_bytes + gateway.batch_envelope_bytes <= limits.max_request_body_bytes.limit);
});

test('batch ingest requires a caller idempotency header', () => {
  const parameters = api().paths['/v1/ingest-batches'].post.parameters;
  const header = parameters.find((parameter) => parameter.name.toLowerCase() === 'idempotency-key');
  assert.ok(header);
  assert.equal(header.in, 'header');
  assert.equal(header.required, true);
});

test('batch ingest reports individual outcomes in a multi-status response', () => {
  const post = api().paths['/v1/ingest-batches'].post;
  const response = post.responses['207'] || post.responses['200'];
  assert.ok(response);
  const schema = response.content['application/json'].schema;
  const resolved = schema.$ref ? api().components.schemas[schema.$ref.split('/').pop()] : schema;
  assert.ok(resolved.properties.results);
  assert.equal(resolved.properties.results.type, 'array');
});

test('status GET path exposes the batch identifier and a success response', () => {
  const pathEntry = Object.entries(api().paths).find(([pathName, value]) =>
    pathName.includes('ingest') && pathName.includes('{batchId}') && value.get
  );
  assert.ok(pathEntry);
  const [pathName, pathItem] = pathEntry;
  const get = pathItem.get;
  assert.ok(get.parameters.some((parameter) => parameter.name === 'batchId' && parameter.in === 'path' && parameter.required));
  assert.ok(get.responses['200']);
  assert.match(pathName, /\{batchId\}/);
});

test('status schema carries aggregate state and item results', () => {
  const get = api().paths['/v1/ingest-batches/{batchId}'].get;
  const ref = get.responses['200'].content['application/json'].schema.$ref;
  const schema = api().components.schemas[ref.split('/').pop()];
  assert.ok(schema.required.includes('state'));
  assert.ok(schema.required.includes('results'));
  assert.equal(schema.properties.results.type, 'array');
});
