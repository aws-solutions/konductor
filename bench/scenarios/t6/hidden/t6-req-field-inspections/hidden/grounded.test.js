const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, requirementTexts } = require('./doc-key');

const texts = () => requirementTexts(blockOf('docs/requirements.md'));

test('requirements preserve the records retention rule', () => {
  assert.ok(texts().some((text) => /7\s*years/i.test(text) && /audit|original/i.test(text) && /legal hold/i.test(text)), 'missing the seven-year auditable retention rule');
});

test('requirements name the managed tablet boundary', () => {
  assert.ok(texts().some((text) => /Android\s*13/i.test(text) && /8[- ]inch/i.test(text) && /MDM|managed/i.test(text)), 'missing the supported managed Android tablet details');
});

test('requirements preserve paper-form non-applicable semantics', () => {
  assert.ok(texts().some((text) => /not applicable/i.test(text) && /missed|blank/i.test(text) && /reading/i.test(text)), 'missing the distinction between a non-applicable and missed reading');
});
