'use strict';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 10000;

function validateDocumentInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  if (typeof input.title !== 'string') errors.push('title must be a string');
  else if (input.title.length > MAX_TITLE_LENGTH) errors.push('title is too long');
  if (typeof input.body !== 'string') errors.push('body must be a string');
  else if (input.body.length > MAX_BODY_LENGTH) errors.push('body is too long');
  return { ok: errors.length === 0, errors };
}

module.exports = { MAX_TITLE_LENGTH, MAX_BODY_LENGTH, validateDocumentInput };
