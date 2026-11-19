const test = require('node:test');
const assert = require('node:assert/strict');
const { createJob, disableJob } = require('../src/jobs');

test('normalizes a valid job', () => {
  const job = createJob({ id: 'j1', title: '  Plan  ', rule: { weekday: 'Tuesday', hour: 8, minute: 0 } });
  assert.deepEqual(job, { id: 'j1', title: 'Plan', rule: { weekday: 'Tuesday', hour: 8, minute: 0 }, enabled: true });
  assert.equal(disableJob(job).enabled, false);
});

test('requires a title and rule', () => {
  assert.throws(() => createJob({ rule: { weekday: 'Monday' } }), /title/);
  assert.throws(() => createJob({ title: 'x' }), /rule/);
});
