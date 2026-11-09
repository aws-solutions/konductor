'use strict';

function createHoldService() {
  return {
    async hold() { return {}; },
    async confirm() { return {}; },
    async release() { return {}; },
    async available() { return 0; },
  };
}

module.exports = { createHoldService };
