// SPDX-License-Identifier: Apache-2.0
'use strict';

// The default judge view: one pasted block of text per run (judge/bundle.js), tools off. Its prompts and cache keys are
// the ones from before views existed, byte for byte (runner/test/judge-view-golden.test.js).

const { buildBundle } = require('../bundle.js');

module.exports = Object.freeze({
  id: 'bundle',
  needs: Object.freeze([]),
  callerNeeds: Object.freeze([]),
  modes: Object.freeze(['rubric', 'pairwise', 'graded', 'pack']),
  prepare({ runDir, result, fixtureDir, limits, redactions }) {
    const bundle = buildBundle({ runDir, result, fixtureDir, limits, redactions });
    return { bundle, promptText: bundle.text };
  },
  call: (caller, req) => caller(req),
  audit: () => null,
  cacheParts: () => null,
});
