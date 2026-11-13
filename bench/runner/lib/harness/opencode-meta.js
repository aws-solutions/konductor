// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the opencode runtime. See kiro-meta.js for why this is its own file.
module.exports = Object.freeze({
  id: 'opencode',
  label: 'opencode',
  armPrefix: 'oc-',
  costUnit: 'usd',
  supports: Object.freeze({ trace: false, stopOn: true, effort: true, runCreditLimit: false, multiTurn: true, capCommands: true, skillStudy: false }),
});
