// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the Strands runtime: a Strands agent run by bench/physical/strands/launch.py with forwarding
// plant tool stubs (kind B, design 15.1). Plant arms only (st-plant-*). See kiro-meta.js for why this is its own file.
const NO_WATCHER = 'the early-stop watcher reads kiro-cli and opencode events only';
const NO_CREDS_FILE = 'a Bedrock model takes exported keys from --aws-profile; the fake model takes none';

module.exports = Object.freeze({
  id: 'strands',
  label: 'Strands Agents',
  proseName: 'Strands',
  armPrefix: 'st-',
  costUnit: 'usd',
  streamFormat: 'strands-jsonl',
  supports: Object.freeze({ trace: false, stopOn: false, effort: false, runCreditLimit: false, multiTurn: false, freshSessions: false, capCommands: false, skillStudy: false, agentEngine: false, prepareOnly: false, armConfig: false }),
  flags: Object.freeze({
    own: Object.freeze(['strands-python', 'strands-agent']),
    // Table order is the order `run` checks them in.
    refused: Object.freeze({
      effort: 'the launcher passes no effort level to the model',
      'stop-on': NO_WATCHER,
      'max-tool-calls': NO_WATCHER,
      'aws-creds-file': NO_CREDS_FILE,
    }),
    perRunCapFlag: null,
  }),
  // strands-agents-tools reads BYPASS_TOOL_CONSENT=true per tool (shell, file_write, editor, python_repl, use_aws and
  // others, checked in strands-agents/tools at b03a6183); the SDK itself never reads it. Plant stubs ask no consent.
  noPrompt: Object.freeze({
    flags: Object.freeze([]),
    env: Object.freeze({ BYPASS_TOOL_CONSENT: 'true' }),
    note: 'covers strands-agents-tools built-ins only; plant tools are forwarding stubs and never prompt',
  }),
  multiTurnNote: 'the launcher runs one prompt per run',
  trace: Object.freeze({ sessionFiles: false, timeNote: null, skillsListing: null }),
});
