// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the Claude Code runtime. See kiro-meta.js for why this is its own file.
module.exports = Object.freeze({
  id: 'claude-code',
  label: 'Claude Code',
  armPrefix: 'cc-',
  costUnit: 'usd',
  supports: Object.freeze({ trace: true, stopOn: false, effort: false, runCreditLimit: false, multiTurn: false, capCommands: false, skillStudy: false }),
});
