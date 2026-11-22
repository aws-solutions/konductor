'use strict';

function oldMoney(value) {
  return `$${Number(value).toFixed(2)}`;
}

module.exports = { oldMoney };
