// SPDX-License-Identifier: Apache-2.0
'use strict';

// T12's (orchestration core: spec workflow, full SDLC, delegation hand-offs, parallel plans) batch config for the shared
// scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t12/scenario.config.js [id ...] [--record]
// The tasks were written by hand (no author model call), so there is no prompt or stage section. Besides the
// reference, stub, lazy and alternative answers, a task may keep a hand-written shallow fake in answers/<id>/shallow/
// (a short answer that uses the right words without doing the work); the dry run scores it with the shallow gate (40).

const fs = require('node:fs');

module.exports = {
  dir: __dirname,
  python: false,
  // Task lists are ordered (the prompts say "in the order they should be done"), so the alternative answer keeps their order.
  answers: { orderedKeys: /path|order|chain|sequence|milestones|steps|timeline|tasks|waves|merge/i },
  variants: (task, cfg) => {
    const d = cfg.answerDir(task.id, 'shallow');
    return fs.existsSync(d) ? [{ name: 'shallow', overlay: d }] : [];
  },
};
