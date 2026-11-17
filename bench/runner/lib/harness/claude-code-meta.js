// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the Claude Code runtime. See kiro-meta.js for why this is its own file.
const AWS_VARS = 'credentials come from the AWS_* variables in the environment that starts the bench, or from --aws-profile';
const NO_WATCHER = 'the early-stop watcher reads kiro-cli and opencode events only';

module.exports = Object.freeze({
  id: 'claude-code',
  label: 'Claude Code',
  proseName: 'Claude Code',
  armPrefix: 'cc-',
  costUnit: 'usd',
  streamFormat: 'claude-stream-json',
  supports: Object.freeze({ trace: true, stopOn: false, effort: false, runCreditLimit: false, multiTurn: false, capCommands: false, skillStudy: false, agentEngine: false, prepareOnly: false, armConfig: true }),
  flags: Object.freeze({
    own: Object.freeze(['claude-bin', 'claude-tools-dir', 'run-budget-usd']),
    // Table order is the order `run` checks them in.
    refused: Object.freeze({
      effort: 'the effort level is not passed to claude, so a value would be recorded but not applied',
      'stop-on': NO_WATCHER,
      'max-tool-calls': NO_WATCHER,
      'aws-creds-file': AWS_VARS,
    }),
    perRunCapFlag: 'run-budget-usd',
  }),
  // How runs skip the agent's own approval prompts (design 15.3, A-4): PERMISSION_MODE in claude-code.js, plus --allowedTools.
  noPrompt: Object.freeze({ flags: Object.freeze(['--permission-mode', 'acceptEdits']), env: Object.freeze({}), note: '--allowedTools lists the tools that run without a prompt' }),
  multiTurnNote: 'the resume flags have not been verified',
  trace: Object.freeze({
    sessionFiles: false,
    timeNote: 'stream.jsonl has no per-event timestamps; time is only known for the whole run',
    skillsListing: 'slash-commands',
  }),
});
