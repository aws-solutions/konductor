'use strict';

// Quote helper from before plans had regions. Not used.
module.exports = function oldQuote(plan) {
  return { starter: 9, team: 29, enterprise: 99 }[plan] * 100;
};
