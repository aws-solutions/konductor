const test = require('node:test');
const assert = require('node:assert/strict');
const { mapCustomer } = require('../src/mapping/field-mapper');
test('mapper normalizes ordinary customer fields', () => {
  const result = mapCustomer({id: 4, email:' A@EXAMPLE.TEST ', full_name:'A Person', credit_limit:'12', subscribed:'Y', joined_at:'2024-01-01T00:00:00Z'});
  assert.deepEqual(result, {id:'4', email:'a@example.test', displayName:'A Person', creditLimit:12, subscribed:true, joinedAt:'2024-01-01T00:00:00.000Z', postalCode:''});
});
