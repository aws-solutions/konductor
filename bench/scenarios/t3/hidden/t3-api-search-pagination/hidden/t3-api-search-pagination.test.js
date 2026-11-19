'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'fixture');
const outputRoot = process.env.OUTPUT_ROOT
  ? path.resolve(root, process.env.OUTPUT_ROOT)
  : path.join(root, 'solution');

function csv(file) {
  const lines = fs.readFileSync(path.join(fixture, file), 'utf8').trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

function number(value) {
  const parsed = Number(value);
  assert.ok(Number.isFinite(parsed), `expected numeric fixture value, got ${value}`);
  return parsed;
}

function byName(rows, name) {
  const row = rows.find((candidate) => candidate.name === name || candidate.metric === name);
  assert.ok(row, `fixture row ${name} is present`);
  return row;
}

function decision() {
  return readDecision(path.join(outputRoot, 'docs', 'decision.md'));
}

function selectedProfile() {
  const d = decision();
  const profile = csv('option-profiles.csv').find((row) => row.option_id === d.chosen);
  assert.ok(profile, `profile for ${d.chosen} is present`);
  return profile;
}

function expectedLimits(profile) {
  const service = csv('service-limits.csv');
  const capacity = csv('capacity.csv');
  const reliability = csv('reliability.csv');
  const traffic = csv('traffic.csv');
  const latency = profile.latency_source === 'deep_offset_p99_ms'
    ? number(byName(traffic, 'deep_offset_p99').value) * number(profile.latency_value)
    : number(profile.latency_value);
  return {
    p99_search_latency: { limit: number(byName(service, 'p99_search_latency').limit), value: latency },
    peak_search_throughput: { limit: number(byName(service, 'peak_search_throughput').limit), value: number(profile.throughput_rps) },
    monthly_search_budget: { limit: number(byName(service, 'monthly_search_budget').limit), value: monthlyCost(profile) },
    catalog_capacity: { limit: number(byName(capacity, 'catalog_capacity').limit), value: number(profile.capacity_items) },
    rpo: { limit: number(byName(reliability, 'rpo').limit), value: number(profile.rpo_seconds) },
    rto: { limit: number(byName(reliability, 'rto').limit), value: number(profile.rto_minutes) }
  };
}

function monthlyCost(profile) {
  const prices = JSON.parse(fs.readFileSync(path.join(fixture, 'price-sheet.json'), 'utf8'));
  const traffic = number(byName(csv('traffic.csv'), 'peak_search_rps').value);
  const b = prices.billing;
  const requests = traffic * b.days_per_month * b.hours_per_day * 3600 / 1000000;
  const option = prices.options.find((candidate) => candidate.id === profile.option_id);
  assert.ok(option, `price for ${profile.option_id} is present`);
  return Number((option.fixed_usd_per_month
    + option.storage_gb * b.storage_usd_per_gb_month
    + option.replicas * b.replica_usd_per_month
    + requests * b.request_usd_per_million).toFixed(2));
}

function openapi() {
  return JSON.parse(fs.readFileSync(path.join(outputRoot, 'api', 'openapi.json'), 'utf8'));
}

test('decision block is readable as JSON', () => {
  assert.equal(typeof decision(), 'object');
});

test('decision has exactly the requested top-level keys', () => {
  assert.deepEqual(Object.keys(decision()).sort(), ['chosen', 'limits', 'monthly_cost_usd', 'options']);
});

test('chosen option is acceptable', () => {
  const d = decision();
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'meta.json'), 'utf8'));
  assert.ok(meta.acceptableOptions.includes(d.chosen));
});

test('chosen option is not the tempting option', () => {
  const d = decision();
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'meta.json'), 'utf8'));
  assert.notEqual(d.chosen, meta.temptingOption);
});

test('options names are the option ids from the price data', () => {
  const d = decision();
  const prices = JSON.parse(fs.readFileSync(path.join(fixture, 'price-sheet.json'), 'utf8'));
  assert.deepEqual([...d.options].sort(), prices.options.map((option) => option.id).sort());
});

test('monthly cost matches the selected price calculation', () => {
  const d = decision();
  assert.ok(near(d.monthly_cost_usd, monthlyCost(selectedProfile())));
});

test('reported latency is recomputed from the selected profile and traffic measurement', () => {
  const d = decision();
  const expected = expectedLimits(selectedProfile()).p99_search_latency;
  assert.ok(near(d.limits.p99_search_latency.value, expected.value));
});

test('reported throughput matches the selected profile', () => {
  const d = decision();
  const expected = expectedLimits(selectedProfile()).peak_search_throughput;
  assert.ok(near(d.limits.peak_search_throughput.value, expected.value));
});

test('reported budget value matches the recomputed monthly cost', () => {
  const d = decision();
  assert.ok(near(d.limits.monthly_search_budget.value, monthlyCost(selectedProfile())));
});

test('reported capacity matches the selected profile', () => {
  const d = decision();
  const expected = expectedLimits(selectedProfile()).catalog_capacity;
  assert.ok(near(d.limits.catalog_capacity.value, expected.value));
});

test('reported recovery point matches the selected profile', () => {
  const d = decision();
  const expected = expectedLimits(selectedProfile()).rpo;
  assert.ok(near(d.limits.rpo.value, expected.value));
});

test('reported recovery time matches the selected profile', () => {
  const d = decision();
  const expected = expectedLimits(selectedProfile()).rto;
  assert.ok(near(d.limits.rto.value, expected.value));
});

test('every hard limit from the input tables is present', () => {
  const d = decision();
  assert.deepEqual(Object.keys(d.limits).sort(), Object.keys(expectedLimits(selectedProfile())).sort());
});

test('every selected value obeys its derived hard limit', () => {
  const d = decision();
  const expected = expectedLimits(selectedProfile());
  assert.ok(meets(d.limits, 'p99_search_latency', expected.p99_search_latency.limit, 'max'));
  assert.ok(meets(d.limits, 'peak_search_throughput', expected.peak_search_throughput.limit, 'min'));
  assert.ok(meets(d.limits, 'monthly_search_budget', expected.monthly_search_budget.limit, 'max'));
  assert.ok(meets(d.limits, 'catalog_capacity', expected.catalog_capacity.limit, 'min'));
  assert.ok(meets(d.limits, 'rpo', expected.rpo.limit, 'max'));
  assert.ok(meets(d.limits, 'rto', expected.rto.limit, 'max'));
});

test('OpenAPI deliverable is valid JSON with an API version', () => {
  const api = openapi();
  assert.equal(api.openapi, '3.0.3');
  assert.equal(typeof api.paths, 'object');
});

test('OpenAPI exposes a GET search operation with a cursor query parameter', () => {
  const api = openapi();
  const search = Object.entries(api.paths).find(([route]) => route.includes('search'));
  assert.ok(search, 'a search path exists');
  const operation = search[1].get;
  assert.ok(operation, 'the search path has GET');
  const refs = (operation.parameters || []).map((parameter) => parameter.$ref
    ? api.components.parameters[parameter.$ref.split('/').pop()]
    : parameter);
  assert.ok(refs.some((parameter) => parameter.name === 'cursor' && parameter.in === 'query'));
});

test('OpenAPI bounds page size and does not expose an offset query parameter', () => {
  const api = openapi();
  const search = Object.entries(api.paths).find(([route]) => route.includes('search'))[1].get;
  const refs = (search.parameters || []).map((parameter) => parameter.$ref
    ? api.components.parameters[parameter.$ref.split('/').pop()]
    : parameter);
  const pageSize = refs.find((parameter) => parameter.name === 'limit');
  assert.ok(pageSize);
  assert.equal(pageSize.schema.maximum, 100);
  assert.equal(refs.some((parameter) => parameter.name === 'offset'), false);
});

test('OpenAPI documents an opaque next_cursor response value', () => {
  const api = openapi();
  const response = Object.values(api.paths).find((pathItem) => pathItem.get).get.responses['200'];
  const schemaRef = response.content['application/json'].schema.$ref;
  const schema = api.components.schemas[schemaRef.split('/').pop()];
  const next = schema.properties.next_cursor;
  assert.ok(next);
  assert.match(next.description, /opaque/i);
  assert.equal(next.type, 'string');
});
