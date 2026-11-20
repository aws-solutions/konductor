'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validate = require('../src/validate');

test('requires a useful card title', () => {
  assert.equal(validate.validateCard({ title: '  ' }).valid, false);
  assert.equal(validate.validateCard({ title: 'A short task' }).valid, true);
});

test('checks label values and known columns', () => {
  assert.equal(validate.validateCard({ title: 'Task', labels: ['review'] }).valid, true);
  assert.equal(validate.validateCard({ title: 'Task', labels: [4] }).errors.labels, 'Labels must be text values');
  assert.equal(validate.isColumnId('active'), true);
  assert.equal(validate.isColumnId('later'), false);
});
