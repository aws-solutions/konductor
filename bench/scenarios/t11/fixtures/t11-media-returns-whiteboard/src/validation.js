'use strict';
function validLine(input) {
  return Boolean(input && typeof input.id === 'string' && Number.isInteger(input.amountCents) && input.amountCents >= 0);
}
module.exports = { validLine };
