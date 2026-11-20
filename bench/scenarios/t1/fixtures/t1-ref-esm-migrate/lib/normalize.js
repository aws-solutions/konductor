'use strict';
function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
module.exports = { normalize };
