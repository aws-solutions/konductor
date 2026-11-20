'use strict';

const conf = require('../../lib/conf');

module.exports = function buildBillingDueDays() {
  const days = conf.read("billing.due.days", 14);
  const label = days + '-day';
  return { days, label };
};
