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
  supports: Object.freeze({ trace: true, stopOn: true, effort: true, runCreditLimit: true, multiTurn: true, freshSessions: true, capCommands: true, skillStudy: true, agentEngine: true, prepareOnly: true, armConfig: true }),
  flags: Object.freeze({ own: Object.freeze([]), refused: Object.freeze({}), perRunCapFlag: null }),
  // How runs skip the agent's own approval prompts (design 15.3, A-4). kiroArgs passes the flag.
  noPrompt: Object.freeze({ flags: Object.freeze(['--trust-all-tools']), env: Object.freeze({}), note: 'plant runs list built-in tools by name plus @plant in the agent file, never @builtin' }),
  // How plant arms mount the gateway (DEBT D-111): the shim named in the plant agent file; the release pins `versions.kiroCli`.
  plant: Object.freeze({ mount: 'agent-file', pinKey: 'kiroCli' }),
  multiTurnNote: null,
  trace: Object.freeze({
    sessionFiles: true,
    timeNote: 'stream.jsonl has no timestamps per event; time is only known per turn',
    skillsListing: 'agent-filter',
  }),
  // What the reports say about the runtime (report/*.js): see CONTRACT.md.
  report: Object.freeze({ factorialKey: 'kiro', usdNote: null, killNote: null, costWords: null }),
  // How the cap commands reach a capability on this runtime (cap/cli.js, cap/registry.js): see CONTRACT.md.
  capabilities: Object.freeze({
    tools: Object.freeze({ skill: 'get_skill', sop: 'prompt', agent: 'subagent', context: 'resource' }),
    actingAgents: true,
    surface: 'agent-filter',
    proxyCallsPerQuery: 2,
  }),
});
