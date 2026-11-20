'use strict';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 10000;

const LIMITS = [['title', MAX_TITLE_LENGTH], ['body', MAX_BODY_LENGTH]];

function validateDocumentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['body must be an object'] };
  const errors = LIMITS.flatMap(([field, max]) => {
    const value = input[field];
    if (typeof value !== 'string') return [`${field} must be a string`];
    return value.length > max ? [`${field} is too long`] : [];
  });
  return { ok: !errors.length, errors };
}

module.exports = { MAX_TITLE_LENGTH, MAX_BODY_LENGTH, validateDocumentInput };
