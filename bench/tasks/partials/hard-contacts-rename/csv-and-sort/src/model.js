'use strict';

class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

// displayName is required (1-80 characters). The deprecated alias fullName is accepted on input.
function nameFrom(input) {
  const d = input.displayName;
  const f = input.fullName;
  if (d !== undefined && f !== undefined && trimmed(d) !== trimmed(f)) {
    throw new ValidationError('fullName', 'displayName and fullName must not differ');
  }
  return d !== undefined ? d : f;
}

function normalizeInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.displayName !== undefined || input.fullName !== undefined) {
    const name = trimmed(nameFrom(input));
    if (!name || name.length > 80) throw new ValidationError('fullName', 'displayName must be 1-80 characters');
    out.displayName = name;
  }
  if (!partial || input.locale !== undefined) {
    const locale = input.locale === undefined ? 'en' : input.locale;
    if (typeof locale !== 'string' || !LOCALE.test(locale)) throw new ValidationError('locale', 'locale must look like en or pt-BR');
    out.locale = locale;
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
