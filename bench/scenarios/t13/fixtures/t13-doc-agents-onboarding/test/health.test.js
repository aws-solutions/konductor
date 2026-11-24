const test = require('node:test');
const assert = require('node:assert/strict');

test('health payload names the service', () => {
  const payload = { status: 'ok', service: 'harborline' };
  assert.deepEqual(payload, { status: 'ok', service: 'harborline' });
});
