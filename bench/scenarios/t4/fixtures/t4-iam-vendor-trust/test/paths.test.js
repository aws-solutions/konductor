'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rolePolicy } = require('../src/paths');

test('role policy paths stay within the role directory', () => {
  assert.match(rolePolicy('monitoring-trust'), /infra[\\/]roles[\\/]monitoring-trust\.json$/);
  assert.throws(() => rolePolicy('../secrets'), /invalid role policy name/);
});
