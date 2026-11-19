const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, requirementTexts } = require('./doc-key');

const requirements = () => requirementTexts(blockOf('docs/requirements.md'));

test('preserves the documented public event vocabulary', () => {
  assert.ok(requirements().some((text) =>
    /payment\.authorized/.test(text) &&
    /payment\.failed/.test(text) &&
    /refund\.created/.test(text) &&
    /payout\.completed/.test(text)
  ), 'the four current event names should be covered');
});

test('keeps prohibited payment data out of webhook payloads and logs', () => {
  assert.ok(requirements().some((text) =>
    /must not (?:include|contain|send)/i.test(text) &&
    /full (?:primary account|payment card) number/i.test(text) &&
    /security code|CVV/i.test(text)
  ), 'requirements should carry the payment-data restriction');
});

test('carries the existing event timing and availability objectives', () => {
  assert.ok(requirements().some((text) => /99\.9%.*monthly availability/i.test(text) && /60\s+seconds.*99th percentile/i.test(text)), 'requirements should preserve the SLO values');
});
