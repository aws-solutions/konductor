const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('the shipped config exposes the two named plans and client bound', () => {
  const config = loadConfig('default');
  assert.equal(config.rateLimit.windowMs, 60000);
  assert.equal(config.rateLimit.maxClients, 1000);
  assert.equal(config.rateLimit.plans.free.limit, 5);
  assert.equal(config.rateLimit.plans.team.limit, 20);
  assert.equal(config.rateLimit.keyPlans['team-demo'], 'team');
});
