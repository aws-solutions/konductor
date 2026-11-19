const test = require('node:test');
const assert = require('node:assert/strict');
const { formatJob, formatTable } = require('../src/format');

test('job formatting includes identity and attempts', () => {
  assert.equal(formatJob({ id: 'x', type: 'work', attempts: 2 }), 'x work (2 attempts)');
  assert.match(formatTable([{ id: 'x', type: 'work', attempts: 2 }]), /x work/);
});
