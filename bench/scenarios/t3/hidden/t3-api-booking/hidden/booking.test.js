'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readDecision, near, meets } = require('./decision-lib');

const ROOT = path.resolve(process.env.T3_ROOT || path.join(__dirname, '..'));
const FIXTURE = path.join(ROOT, 'fixture');
const solutionPath = (relative) => {
  const direct = path.join(ROOT, relative);
  return fs.existsSync(direct) ? direct : path.join(ROOT, 'solution', relative);
};
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(FIXTURE, relative), 'utf8'));
const traffic = readJson('traffic.json');
const prices = readJson('prices.json');
const gateway = readJson('gateway.json');
const levels = readJson('service-levels.json');
const decision = readDecision(solutionPath('docs/decision.md'));
const openapi = JSON.parse(fs.readFileSync(solutionPath('api/openapi.json'), 'utf8'));
const chosen = traffic.pagination_options[decision.chosen];
const volumes = traffic.monthly_requests;
const selectedPrice = prices.pagination_options[decision.chosen];
const expectedCost = selectedPrice.monthly_base_usd
  + (volumes.list / 1_000_000) * selectedPrice.list_usd_per_million
  + (volumes.get / 1_000_000) * selectedPrice.get_usd_per_million
  + (volumes.create / 1_000_000) * selectedPrice.create_usd_per_million;
const expected = {
  response_body_bytes: chosen.page_size * traffic.booking_item_serialized_bytes,
  list_p95_latency_ms: chosen.list_p95_latency_ms,
  peak_capacity_rps: chosen.peak_capacity_rps,
  monthly_budget_usd: expectedCost,
  rpo_minutes: chosen.rpo_minutes,
  rto_minutes: chosen.rto_minutes
};

function resolve(value) {
  if (!value || !value.$ref) return value;
  const parts = value.$ref.split('/');
  return openapi.components[parts[2]][parts[3]];
}

function responseSchema(operation, status) {
  const response = resolve(operation.responses[status]);
  return resolve(response.content['application/json'].schema);
}

function parameter(operation, name, location) {
  return operation.parameters
    .map(resolve)
    .find((candidate) => candidate.name === name && candidate.in === location);
}

test('decision block can be parsed', () => {
  assert.equal(typeof decision, 'object');
  assert.ok(decision);
});

test('chosen pagination option is acceptable', () => {
  assert.deepEqual([decision.chosen], ['cursor']);
});

test('chosen pagination option is not the tempting option', () => {
  assert.notEqual(decision.chosen, 'offset');
});

test('decision considers both pagination options', () => {
  assert.deepEqual(new Set(decision.options), new Set(['cursor', 'offset']));
});

test('decision block has exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(decision).sort(), ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('reported response size is derived and within the gateway limit', () => {
  assert.ok(near(decision.limits.response_body_bytes.value, expected.response_body_bytes));
  assert.ok(meets(decision.limits, 'response_body_bytes', gateway.response_body_limit_bytes, 'max'));
});

test('reported list latency is derived and within its limit', () => {
  assert.ok(near(decision.limits.list_p95_latency_ms.value, expected.list_p95_latency_ms));
  assert.ok(meets(decision.limits, 'list_p95_latency_ms', levels.list_p95_latency_ms_limit, 'max'));
});

test('reported capacity is derived and meets the production minimum', () => {
  assert.ok(near(decision.limits.peak_capacity_rps.value, expected.peak_capacity_rps));
  assert.ok(meets(decision.limits, 'peak_capacity_rps', levels.peak_capacity_rps_minimum, 'min'));
});

test('reported monthly cost is derived and within budget', () => {
  assert.ok(near(decision.monthly_cost_usd, expectedCost));
  assert.ok(meets(decision.limits, 'monthly_budget_usd', levels.monthly_budget_usd_limit, 'max'));
  assert.ok(near(decision.limits.monthly_budget_usd.value, expectedCost));
});

test('reported recovery point is derived and within its limit', () => {
  assert.ok(near(decision.limits.rpo_minutes.value, expected.rpo_minutes));
  assert.ok(meets(decision.limits, 'rpo_minutes', levels.rpo_minutes_limit, 'max'));
});

test('reported recovery time is derived and within its limit', () => {
  assert.ok(near(decision.limits.rto_minutes.value, expected.rto_minutes));
  assert.ok(meets(decision.limits, 'rto_minutes', levels.rto_minutes_limit, 'max'));
});

test('all hard limits are present with no unlisted limit', () => {
  assert.deepEqual(Object.keys(decision.limits).sort(), Object.keys(expected).sort());
  for (const entry of Object.values(decision.limits)) {
    assert.equal(typeof entry.limit, 'number');
    assert.equal(typeof entry.value, 'number');
  }
});

test('OpenAPI document declares a supported 3.x version and required paths', () => {
  assert.match(openapi.openapi, /^3\./);
  assert.ok(openapi.paths['/rooms/{roomId}/bookings']);
  assert.ok(openapi.paths['/bookings/{bookingId}']);
  assert.ok(openapi.paths['/bookings']);
});

test('list operation has room, date-range, cursor, and page-size parameters', () => {
  const operation = openapi.paths['/rooms/{roomId}/bookings'].get;
  assert.ok(operation);
  for (const [name, location] of [['roomId', 'path'], ['from', 'query'], ['to', 'query'], ['cursor', 'query'], ['pageSize', 'query']]) {
    assert.ok(parameter(operation, name, location), `${name} ${location} parameter missing`);
  }
  assert.equal(parameter(operation, 'roomId', 'path').required, true);
  assert.equal(parameter(operation, 'from', 'query').required, true);
  assert.equal(parameter(operation, 'to', 'query').required, true);
});

test('list operation exposes a bounded paginated response schema', () => {
  const operation = openapi.paths['/rooms/{roomId}/bookings'].get;
  const pageSize = parameter(operation, 'pageSize', 'query');
  assert.equal(pageSize.schema.type, 'integer');
  assert.ok(Number.isInteger(pageSize.schema.maximum));
  assert.ok(pageSize.schema.maximum * traffic.booking_item_serialized_bytes <= gateway.response_body_limit_bytes);
  assert.ok(pageSize.schema.maximum <= chosen.page_size);
  const schema = responseSchema(operation, '200');
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.items.type, 'array');
  assert.ok(schema.properties.nextCursor);
});

test('get operation has an identifier parameter and booking response schema', () => {
  const operation = openapi.paths['/bookings/{bookingId}'].get;
  assert.ok(operation);
  const id = parameter(operation, 'bookingId', 'path');
  assert.ok(id);
  assert.equal(id.required, true);
  const schema = responseSchema(operation, '200');
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties.id);
});

test('create operation has idempotency header, request, and response schemas', () => {
  const operation = openapi.paths['/bookings'].post;
  assert.ok(operation);
  const key = parameter(operation, 'Idempotency-Key', 'header');
  assert.ok(key);
  assert.equal(key.required, true);
  assert.equal(operation.requestBody.required, true);
  assert.ok(operation.requestBody.content['application/json'].schema);
  assert.ok(responseSchema(operation, '201'));
});

test('an error schema exists and is used by error responses', () => {
  assert.ok(openapi.components.schemas.Error);
  const operations = [
    openapi.paths['/rooms/{roomId}/bookings'].get,
    openapi.paths['/bookings/{bookingId}'].get,
    openapi.paths['/bookings'].post
  ];
  const errorSchemas = operations.flatMap((operation) => Object.entries(operation.responses)
    .filter(([status]) => status.startsWith('4'))
    .map(([, response]) => resolve(response).content['application/json'].schema));
  assert.ok(errorSchemas.some((schema) => schema.$ref === '#/components/schemas/Error'));
});
