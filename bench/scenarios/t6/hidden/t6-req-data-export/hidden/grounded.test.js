const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, requirementTexts } = require('./doc-key');

test('defines the customer record families in the archive', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  assert.ok(texts.some((t) => /account/i.test(t) && /users?/i.test(t) && /appointments?/i.test(t) && /custom fields/i.test(t) && /integrations?/i.test(t)));
});

test('honors the one-active-background-job infrastructure limit', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  assert.ok(texts.some((t) => /one active/i.test(t) && /(?:export|archive).*(?:job|request)/i.test(t) && /account/i.test(t)));
});

test('keeps secrets and other tenants out of the archive', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  assert.ok(texts.some((t) => /secret/i.test(t) && /(?:another|other) tenant/i.test(t)));
});
