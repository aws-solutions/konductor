const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('config accepts a valid port', () => {
  assert.equal(loadConfig({ PORT: '9123', LEDGER_LABEL: 'local' }).port, 9123);
  assert.equal(loadConfig({ PORT: '9123', LEDGER_LABEL: 'local' }).ledgerLabel, 'local');
});
