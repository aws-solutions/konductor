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
  supports: Object.freeze({ trace: false, stopOn: true, effort: true, runCreditLimit: false, multiTurn: true, freshSessions: false, capCommands: true, skillStudy: false, agentEngine: false, prepareOnly: false, armConfig: false }),
  flags: Object.freeze({ own: Object.freeze([]), refused: Object.freeze({}), perRunCapFlag: null }),
  // How runs skip the agent's own approval prompts (design 15.3, A-4): opencode-translate.js writes an allow map.
  noPrompt: Object.freeze({ flags: Object.freeze([]), env: Object.freeze({}), note: 'the agent file permission map sets every tool to allow' }),
  multiTurnNote: null,
  trace: Object.freeze({ sessionFiles: false, timeNote: null, skillsListing: null }),
});
