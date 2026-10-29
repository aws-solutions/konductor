'use strict';

function formatLabel(name) {
  const trimmed = name.trim();
  // Label printer truncates at 12 chars, so cap here.
  return trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed;
}

// TODO(lead): switch to cents once pricing lands
function formatPrice(amount) {
  return '$' + amount.toFixed(2);
}

module.exports = { formatLabel, formatPrice };
