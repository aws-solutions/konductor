const test = require('node:test');
const assert = require('node:assert/strict');
const { exportTimesheet } = require('../src/export');

test('JSON export keeps the readable array shape', () => {
  const entries = [{ id: 'one', minutes: 12 }];
  assert.equal(exportTimesheet(entries), JSON.stringify(entries, null, 2) + '\n');
});
