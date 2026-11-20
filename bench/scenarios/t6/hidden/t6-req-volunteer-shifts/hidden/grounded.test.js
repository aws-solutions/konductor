const test = require('node:test');
const assert = require('node:assert/strict');
const { requirementTexts, blockOf } = require('./doc-key');

test('requirements include shift caps from handbook', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const shiftCapTerms = [
    /shift.*cap/i,
    /capacity.*limit/i,
    /limit.*per.*shift/i,
    /maximum.*volunteer/i,
    /site.*specific.*(cap|limit)/i
  ];
  
  // Check that shift caps are mentioned
  const hasShiftCaps = reqs.some(req => shiftCapTerms.some(term => term.test(req)));
  assert.ok(hasShiftCaps, 'Expected requirements to mention shift caps or capacity limits');
});

test('requirements include background check roles from safeguarding policy', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const roles = [
    /driver.*background/i,
    /kitchen.*background/i,
    /shelter.*background/i,
    /vulnerable.*population.*background/i
  ];
  
  const found = roles.filter(role => reqs.some(r => role.test(r)));
  assert.ok(found.length >= 2, `Expected at least 2 background check roles, found ${found.length}`);
});

test('requirements include minimum age and parent consent', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const ageRules = [
    /minimum.*age.*16/i,
    /16.*years.*old/i,
    /parent.*consent.*16.*17/i,
    /under.*18.*parent/i
  ];
  
  const found = ageRules.filter(rule => reqs.some(r => rule.test(r)));
  assert.ok(found.length >= 1, `Expected minimum age/parent consent rules, found ${found.length}`);
});

test('requirements include data privacy rules for coordinators', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  const privacyRules = [
    /coordinator.*cannot.*medical/i,
    /hide.*medical.*information/i,
    /privacy.*coordinator.*access/i,
    /restrict.*coordinator.*view/i
  ];
  
  const found = privacyRules.filter(rule => reqs.some(r => rule.test(r)));
  assert.ok(found.length >= 1, `Expected data privacy rules for coordinators, found ${found.length}`);
});