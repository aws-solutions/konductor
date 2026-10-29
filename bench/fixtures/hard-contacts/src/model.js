'use strict';

class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

// fullName is required and must be unique across contacts.
function normalizeInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || 'fullName' in input) {
    const name = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    if (!name || name.length > 80) throw new ValidationError('fullName', 'fullName must be 1-80 characters');
    out.fullName = name;
  }
  if (!partial || 'email' in input) {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!email.includes('@')) throw new ValidationError('email', 'email must contain @');
    out.email = email;
  }
  if ('phone' in input) out.phone = input.phone === null ? null : String(input.phone).trim() || null;
  else if (!partial) out.phone = null;
  return out;
}

module.exports = { ValidationError, normalizeInput };
