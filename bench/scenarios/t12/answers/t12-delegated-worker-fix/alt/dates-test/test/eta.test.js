'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deliveryDate } = require('../src/eta.js');

const cases = [
  ['2026-03-06', 'standard', '2026-03-11', 'Friday standard crosses a weekend'],
  ['2026-04-02', 'express', '2026-04-07', 'Easter: Good Friday and Easter Monday'],
  ['2026-12-24', 'express', '2026-12-29', 'Christmas holiday on a Saturday adds nothing'],
  ['2026-03-07', 'express', '2026-03-09', 'shipped on a Saturday'],
];

for (const [ship, service, want, why] of cases) {
  test(`delivery date: ${why}`, () => assert.equal(deliveryDate(ship, service), want));
}
