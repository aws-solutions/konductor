'use strict';

function cleanLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

module.exports = { cleanLabel };
