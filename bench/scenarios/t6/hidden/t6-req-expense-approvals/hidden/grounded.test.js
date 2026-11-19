const test = require('node:test');
const assert = require('node:assert/strict');
const { requirementTexts, blockOf } = require('./doc-key');

test('includes requirement for £500 Head of Finance approval', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const has500 = reqs.some(t => /\b500\b|\b£500\b|\bfive.*hundred/i.test(t) && /\bhead.*finance|\bho.*f/i.test(t));
  assert.ok(has500, 'Should require Head of Finance approval for claims over £500');
});

test('includes requirement for 7-year record retention', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const has7Year = reqs.some(t => /\b7\b|\bseven\b/i.test(t) && /\byear.*retention|\bretain.*year/i.test(t));
  assert.ok(has7Year, 'Should require 7-year record retention for audit');
});

test('includes requirement for grant code validation', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const hasGrantValidation = reqs.some(t => /\bgrant.*valid|\bvalid.*grant|\bgrant.*code.*check/i.test(t));
  assert.ok(hasGrantValidation, 'Should require validation of grant codes against restrictions');
});

test('includes requirement for 30-day submission deadline', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const has30Day = reqs.some(t => /\b30\b|\bthirty\b/i.test(t) && /\bday.*submit|submission.*deadline/i.test(t));
  assert.ok(has30Day, 'Should enforce 30-day submission deadline');
});