'use strict';

const { UsageError } = require('./errors');

const MAX_TEXT = 280;

function validateText(text) {
  if (typeof text !== 'string' || text.trim().length === 0 || text.trim().length > MAX_TEXT) {
    throw new UsageError(`note text must be 1 to ${MAX_TEXT} characters`);
  }
  return text.trim();
}

module.exports = { validateText, MAX_TEXT };
