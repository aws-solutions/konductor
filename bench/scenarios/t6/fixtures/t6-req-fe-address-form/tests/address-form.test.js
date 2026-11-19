const test = require('node:test');
const assert = require('node:assert/strict');
const { createAddressForm } = require('../src/components/AddressForm');

test('requires the core address fields', () => {
  const errors = createAddressForm().submit({ country: 'US', region: 'OR' });
  assert.equal(errors.addressLine1, 'Enter a value');
  assert.equal(errors.city, 'Enter a value');
  assert.equal(errors.postalCode, 'Enter a value');
});

test('accepts a valid US postal code', () => {
  const errors = createAddressForm().submit({ addressLine1: '4 Cedar Way', city: 'Port Rowan', region: 'OR', postalCode: '97205', country: 'US' });
  assert.deepEqual(errors, {});
});
