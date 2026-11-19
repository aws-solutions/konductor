const test = require('node:test');
const assert = require('node:assert/strict');
const { postcodeLooksValid } = require('../src/validation/postcode');

test('recognises the formats in the validation module', () => {
  assert.equal(postcodeLooksValid('CA', 'K1A 0B1'), true);
  assert.equal(postcodeLooksValid('GB', 'SW1A 1AA'), true);
  assert.equal(postcodeLooksValid('US', '97205-1234'), true);
});

test('does not reject an unknown country format', () => {
  assert.equal(postcodeLooksValid('ZZ', 'anything'), true);
});
