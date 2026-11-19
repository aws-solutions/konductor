'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { integrationNames, accountFor } = require('../src/catalog');

test('catalog exposes the configured integration keys', () => {
  assert.deepEqual(integrationNames(), ['monitoring', 'backup', 'partnerCi', 'deployment']);
  assert.equal(accountFor('backup'), '333344445555');
  assert.equal(accountFor('missing'), undefined);
});
