'use strict';

// Helpers from the first report renderer. Nothing requires this file any more.
function padLeft(s, n) {
  return String(s).padStart(n);
}

function money(n) {
  return `$${n.toFixed(2)}`;
}

module.exports = { padLeft, money };
