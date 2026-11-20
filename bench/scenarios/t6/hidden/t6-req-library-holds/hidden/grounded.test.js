const test = require('node:test');
const assert = require('node:assert/strict');
const { requirementTexts, blockOf } = require('./doc-key');

test('requirements include physical and e-book holds', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  const hasPhysical = texts.some(t => /physical.*book|print.*material/i.test(t));
  const hasEbook = texts.some(t => /e.?book|digital.*book|electronic/i.test(t));
  assert.ok(hasPhysical && hasEbook, 'Must cover both physical books and e-books');
});

test('requirements address multiple notification channels', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  const channels = texts.filter(t => /notification|alert|email|sms|text|phone/i.test(t));
  assert.ok(channels.length >= 2, 'Should support at least two notification channels');
});

test('requirements consider branch capacities and constraints', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  const branchRelated = texts.filter(t => /capacit|storage|shelf space|limited hours|opening hours|staffing|locker/i.test(t) && /branch|north hill|eastside|central/i.test(t));
  assert.ok(branchRelated.length >= 1, 'Should address branch-specific constraints');
});

test('requirements include accessibility compliance', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  const access = texts.some(t => /accessibility|wcag|screen.*reader|keyboard.*nav/i.test(t));
  assert.ok(access, 'Must include accessibility requirements');
});

test('requirements address different card types', () => {
  const texts = requirementTexts(blockOf('docs/requirements.md'));
  const cardTypes = texts.filter(t => /regular|student|senior|child|institutional.*card/i.test(t));
  assert.ok(cardTypes.length >= 2, 'Should address at least two card types');
});