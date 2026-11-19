const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig, withEnvironment } = require('../src/config');

test('loads the checked-in defaults', () => {
  const config = readConfig();
  assert.equal(config.timeZone, 'UTC');
  assert.equal(config.rateLimit.limit, 3);
});

test('applies supported environment values', () => {
  const result = withEnvironment({ timeZone: 'UTC', outboxDirectory: 'x', rateLimit: { limit: 3, windowMs: 4 } }, {
    REMINDER_TIME_ZONE: 'Europe/Paris', REMINDER_OUTBOX: 'records', REMINDER_RATE_LIMIT: '5'
  });
  assert.deepEqual(result, { timeZone: 'Europe/Paris', outboxDirectory: 'records', rateLimit: { limit: 5, windowMs: 4 } });
});
