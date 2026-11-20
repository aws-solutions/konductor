'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildBillingPage() {
  const size = read("billing.page.size", 25);
  const pagesFor200 = 200 / size;
  return { size, pagesFor200 };
};
