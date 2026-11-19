const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, requirementTexts } = require('./doc-key');

const requirements = () => requirementTexts(blockOf('docs/requirements.md'));

test('carries the existing checkout analytics contract into a requirement', () => {
  assert.ok(requirements().some((text) => /checkout_address_viewed/i.test(text) && /checkout_address_submitted/i.test(text) && /checkout_address_lookup_used/i.test(text) && /payload/i.test(text)));
});

test('carries the privacy logging rule into a requirement', () => {
  assert.ok(requirements().some((text) => /must not log|must not record|do not log/i.test(text) && /complete address/i.test(text) && /postal code/i.test(text)));
});

test('carries the current core field contract into a requirement', () => {
  assert.ok(requirements().some((text) => /address line 1/i.test(text) && /city/i.test(text) && /postal code/i.test(text) && /country/i.test(text) && /second line/i.test(text)));
});
