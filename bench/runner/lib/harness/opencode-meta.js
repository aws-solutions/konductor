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
  // No plant arms: no shim mount and no plant stream reader for opencode-json.
  plant: null,
  multiTurnNote: null,
  trace: Object.freeze({ sessionFiles: false, timeNote: null, skillsListing: null }),
  report: Object.freeze({
    factorialKey: null,
    usdNote: 'USD is list price computed by opencode from token counts (input, output, cache read, cache write); it is not a bill. Tokens and calls are summed over the parent session and every subagent session read from the session database.',
    killNote: 'A timed-out run is charged the rows present at the kill or the arm median, whichever is larger.',
    costWords: null,
  }),
  capabilities: Object.freeze({
    tools: Object.freeze({ skill: 'skill', sop: 'skill', agent: 'task', context: 'resource' }),
    actingAgents: false,
    surface: 'skill-index',
    proxyCallsPerQuery: 1,
  }),
});
