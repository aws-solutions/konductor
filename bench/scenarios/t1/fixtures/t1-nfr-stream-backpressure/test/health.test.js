const test = require('node:test');
const assert = require('node:assert/strict');
const { healthPayload } = require('../src/health');

test('health payload includes service identity', () => {
  assert.deepEqual(healthPayload('1.0.0'), { ok: true, service: 'northstar', version: '1.0.0' });
});
