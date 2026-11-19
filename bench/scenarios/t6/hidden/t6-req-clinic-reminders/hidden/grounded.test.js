const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, requirementTexts } = require('./doc-key');

const requirements = () => requirementTexts(blockOf('docs/requirements.md'));

test('requires an explicit consent value before sending', () => {
  assert.ok(requirements().some((text) => /consent/i.test(text) && /yes|explicit|blank|unknown/i.test(text)), 'no explicit consent gate found');
});

test('excludes cancelled appointments from sends', () => {
  assert.ok(requirements().some((text) => /cancelled/i.test(text) && /(?:must not|never|exclude|suppress).*(?:send|reminder)/i.test(text)), 'no cancelled-appointment send exclusion found');
});

test('configures every clinic with its recorded local timezone', () => {
  assert.ok(requirements().some((text) => /Cedar Grove.*Harbor Point.*Northgate/i.test(text) && /local time ?zone/i.test(text)), 'no all-clinic timezone configuration found');
});
