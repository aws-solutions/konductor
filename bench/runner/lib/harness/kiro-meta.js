// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the kiro-cli runtime. A separate file with no requires so runtime.js and arms.js can read it
// without loading the harness (the harness needs result.js, which needs runtime.js).
module.exports = Object.freeze({
  id: 'kiro-cli',
  label: 'Kiro CLI',
  proseName: 'kiro-cli',
  armPrefix: '',
  costUnit: 'credits',
  streamFormat: 'kiro-acp',
  supports: Object.freeze({ trace: true, stopOn: true, effort: true, runCreditLimit: true, multiTurn: true, capCommands: true, skillStudy: true, agentEngine: true, prepareOnly: true }),
  flags: Object.freeze({ own: Object.freeze([]), refused: Object.freeze({}), perRunCapFlag: null }),
  multiTurnNote: null,
  trace: Object.freeze({
    sessionFiles: true,
    timeNote: 'stream.jsonl has no timestamps per event; time is only known per turn',
    skillsListing: 'agent-filter',
  }),
});
