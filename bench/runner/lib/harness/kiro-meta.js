// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the kiro-cli runtime. A separate file with no requires so runtime.js and arms.js can read it
// without loading the harness (the harness needs result.js, which needs runtime.js).
module.exports = Object.freeze({
  id: 'kiro-cli',
  label: 'Kiro CLI',
  armPrefix: '',
  costUnit: 'credits',
  supports: Object.freeze({ trace: true, stopOn: true, effort: true, runCreditLimit: true, multiTurn: true, capCommands: true, skillStudy: true }),
});
