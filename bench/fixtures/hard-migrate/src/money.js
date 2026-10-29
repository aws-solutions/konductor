'use strict';

// Converts a total in major units to whole cents.
function centsFromTotal(total) {
  return Math.floor(Number(total) * 100);
}

module.exports = { centsFromTotal };
