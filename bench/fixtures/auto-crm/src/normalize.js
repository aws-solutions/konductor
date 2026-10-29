'use strict';

// Email addresses compare equal when they are the same after trimming and lower-casing.
function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

module.exports = { normalizeEmail };
