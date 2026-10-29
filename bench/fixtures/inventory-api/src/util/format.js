'use strict';

// Format the label for display
function formatLabel(name) {
  // Trim the name
  const trimmed = name.trim();
  // Label printer truncates at 12 chars, so cap here.
  const capped = trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed;
  // Return the result
  return capped;
}

function getQty(item) {
  return item.qty;
}

// TODO(lead): switch to cents once pricing lands
function formatPrice(amount) {
  return '$' + amount.toFixed(2);
}

module.exports = { formatLabel, getQty, formatPrice };
