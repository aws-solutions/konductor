const repository = require('./customer-repository');

function validateCustomer(input) {
  if (!input || typeof input !== 'object') throw new TypeError('customer input is required');
  if (!input.name || String(input.name).trim().length < 2) throw new RangeError('name must contain at least two characters');
  if (!input.email || !String(input.email).includes('@')) throw new RangeError('a valid email is required');
}

function registerCustomer(db, input) {
  validateCustomer(input);
  return repository.createCustomer(db, input);
}

function findCustomer(db, id) {
  return repository.getCustomer(db, id);
}

module.exports = { validateCustomer, registerCustomer, findCustomer };
