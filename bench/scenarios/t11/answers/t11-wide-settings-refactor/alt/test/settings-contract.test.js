const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = require('../lib/config');

test('migrated callers preserve nested settings and derived fields', () => {
  assert.deepEqual(require('../apps/warehouse/cold')(), { maxCelsius: 5, warning: 7 });
  assert.deepEqual(require('../jobs/eu-queue')('apac'), {
    url: 'https://queue.invalid',
    health: 'https://queue.invalid/health'
  });
  assert.equal(config.value('billing', 'retries', { fallback: 0 }), 0);
});

test('the package facade no longer publishes the retired reader', () => {
  const facade = require('../lib');
  assert.equal(typeof facade.value, 'function');
  assert.equal(facade.read, undefined);
  assert.equal(fs.existsSync(require('node:path').join(__dirname, '..', 'lib', 'conf.js')), false);
});
