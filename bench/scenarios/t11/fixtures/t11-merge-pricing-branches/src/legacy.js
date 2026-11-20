'use strict';

function legacyTotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

module.exports = { legacyTotal };
