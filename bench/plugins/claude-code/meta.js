// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static description of the Claude Code runtime. See bench/plugins/kiro-cli/meta.js for why this is its own file.
const AWS_VARS = 'credentials come from the AWS_* variables in the environment that starts the bench, or from --aws-profile';
const NO_WATCHER = 'the early-stop watcher reads kiro-cli and opencode events only';

module.exports = Object.freeze({
  id: 'claude-code',
  label: 'Claude Code',
  proseName: 'Claude Code',
  armPrefix: 'cc-',
  costUnit: 'usd',
  streamFormat: 'claude-stream-json',
  supports: Object.freeze({ trace: true, stopOn: false, effort: true, runCreditLimit: false, multiTurn: true, freshSessions: true, capCommands: false, skillStudy: false, agentEngine: false, prepareOnly: true, armConfig: true }),
  flags: Object.freeze({
    own: Object.freeze(['claude-bin', 'claude-tools-dir', 'run-budget-usd', 'allow-claude-change']),
    // Table order is the order `run` checks them in.
    refused: Object.freeze({
      'stop-on': NO_WATCHER,
      'max-tool-calls': NO_WATCHER,
      'aws-creds-file': AWS_VARS,
    }),
    perRunCapFlag: 'run-budget-usd',
  }),
  // How runs skip the agent's own approval prompts (design 15.3, A-4): PERMISSION_MODE in claude-code.js, plus --allowedTools.
  noPrompt: Object.freeze({ flags: Object.freeze(['--permission-mode', 'acceptEdits']), env: Object.freeze({}), note: '--allowedTools lists the tools that run without a prompt' }),
  // Plant arms (cc-plant-*, DEBT D-111): the shim is the only MCP server, given with --mcp-config; the release pins
  // `versions.claudeCode` ({version, sha256}).
  plant: Object.freeze({ mount: 'mcp-config', pinKey: 'claudeCode' }),
  multiTurnNote: null,
  trace: Object.freeze({
    sessionFiles: false,
    timeNote: 'stream.jsonl has no per-event timestamps; time is only known for the whole run',
    skillsListing: 'slash-commands',
  }),
  report: Object.freeze({
    factorialKey: 'cc',
    usdNote: 'USD is the list price Claude Code reports (`total_cost_usd`, cost basis list); it is not a bill. Tokens are summed from the per-model usage of the last result line, which covers the main session and its sub-agents; calls are the distinct assistant messages.',
    killNote: 'A run killed before its result line reports no cost; it is charged the runner\'s ledger value when one was recorded.',
    costWords: 'USD at list price, as Claude Code reports it',
  }),
  capabilities: null,
  // What --introspect records (runner/lib/introspect): OpenTelemetry to a loopback OTLP sink, and the session transcripts.
  introspect: Object.freeze({ probe: 'otlp' }),
});
