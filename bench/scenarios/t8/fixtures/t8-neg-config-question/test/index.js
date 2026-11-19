'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadEnvironment, render } = require('../scripts/render-config.js');

test('each environment renders all configured services', () => {
  for (const environment of ['development', 'staging', 'production']) {
    const services = loadEnvironment(environment);
    assert.equal(services.length, 9);
    assert.ok(services.every((service) => service.environment === environment));
  }
});

test('rendered service names are stable and sorted', () => {
  const names = render('production').services.map((service) => service.service);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
});

test('production rendering returns complete effective records', () => {
  const result = render('production');
  assert.equal(result.environment, 'production');
  assert.equal(result.services.length, 9);
  assert.ok(result.services.every((service) => typeof service.logLevel === 'string'));
});

test('configuration records include deployment settings', () => {
  for (const service of loadEnvironment('staging')) {
    assert.ok(Number.isInteger(service.replicas));
    assert.match(service.resources.cpu, /^\d+m$/);
    assert.match(service.resources.memory, /^(\d+Mi|\d+Gi)$/);
    assert.ok(service.featureFlags && typeof service.featureFlags === 'object');
  }
});
