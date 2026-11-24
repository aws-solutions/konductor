// SPDX-License-Identifier: Apache-2.0
'use strict';

// Descriptor of the template harness (runner/lib/harness/CONTRACT.md, "Descriptor"). No require: the runner reads it
// before any harness module loads. Copy the folder to bench/plugins/<name>/, then set `id` (= the folder name and the
// plugin.json name), the arm prefix and the stream format, and say what your agent supports.
module.exports = Object.freeze({
  id: 'plugin-template',
  label: 'Template agent',
  proseName: 'the template agent',
  armPrefix: 'tpl-',
  costUnit: 'usd',
  streamFormat: 'template-jsonl',
  supports: Object.freeze({ trace: false, stopOn: false, effort: false, runCreditLimit: false, multiTurn: false, freshSessions: false, capCommands: false, skillStudy: false, agentEngine: false, prepareOnly: false, armConfig: false }),
  flags: Object.freeze({
    own: Object.freeze([]),
    refused: Object.freeze({ effort: 'the template agent takes no effort level' }),
    perRunCapFlag: null,
  }),
  noPrompt: Object.freeze({ flags: Object.freeze([]), env: Object.freeze({}), note: 'the template agent never asks for permission' }),
  // No plant arms. A plant-capable agent sets { mount, pinKey } here; the kit's plant-kind check reads it.
  plant: null,
  multiTurnNote: 'the template agent runs one prompt per run',
  trace: Object.freeze({ sessionFiles: false, timeNote: null, skillsListing: null }),
  report: Object.freeze({ factorialKey: null, usdNote: null, killNote: null, costWords: null }),
  capabilities: null,
  // No --introspect probe: the run gets only the stream-based timeline (runner/lib/introspect).
  introspect: null,
});
