// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the opencode runtime. See kiro-meta.js for why this is its own file.
module.exports = Object.freeze({
  id: 'opencode',
  label: 'opencode',
  proseName: 'opencode',
  armPrefix: 'oc-',
  costUnit: 'usd',
  streamFormat: 'opencode-json',
  supports: Object.freeze({ trace: false, stopOn: true, effort: true, runCreditLimit: false, multiTurn: true, capCommands: true, skillStudy: false, agentEngine: false, prepareOnly: false }),
  flags: Object.freeze({ own: Object.freeze([]), refused: Object.freeze({}), perRunCapFlag: null }),
  multiTurnNote: null,
  trace: Object.freeze({ sessionFiles: false, timeNote: null, skillsListing: null }),
});
