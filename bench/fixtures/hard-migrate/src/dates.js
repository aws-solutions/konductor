'use strict';

// Dates are handled in local time.
function isoFromUs(text) {
  const [m, d, y] = String(text).split('/').map(Number);
  return new Date(y, m - 1, d).toISOString().slice(0, 10);
}

module.exports = { isoFromUs };
