const test = require('node:test');
const assert = require('node:assert/strict');
const zone = require('../apps/warehouse/zone');
const strict = require('../apps/warehouse/strict');

test('warehouse modules keep their operational defaults', () => {
  assert.deepEqual(zone(), { zone: 'north-2', label: 'north-2-dock' });
  assert.deepEqual(strict(), { strict: false, mode: 'soft' });
});
