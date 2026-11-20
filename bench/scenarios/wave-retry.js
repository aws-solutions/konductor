#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which runs of a pilot wave the service throttled (DEBT D-138), and how much of the wave's ceiling is left to rerun
// them once. bench/scripts/pilot-wave.sh calls it after a paid wave:
//   node bench/scenarios/wave-retry.js OUT_DIR --ceiling N   prints {"tasks":[...],"charged":C,"left":L}

const { loadRuns } = require('../report/load.js');
const { throttled } = require('./pilot-table.js');

function throttledRetry(dir, ceiling) {
  const tasks = new Set();
  let charged = 0;
  for (const e of loadRuns([dir]).runs) {
    const r = e.result;
    if (r.status === 'budget_skipped') continue;
    charged += Number(r.creditsCharged ?? r.credits ?? 0) || 0;
    if (r.status !== 'success' && throttled(r, e.dir)) tasks.add(e.taskId);
  }
  const left = Math.max(0, Math.floor(ceiling - charged));
  return { tasks: [...tasks].sort(), charged: Math.round(charged * 100) / 100, left };
}

if (require.main === module) {
  const [dir, flag, n] = process.argv.slice(2);
  const ceiling = Number(n);
  if (!dir || flag !== '--ceiling' || !Number.isFinite(ceiling)) {
    process.stderr.write('usage: node wave-retry.js OUT_DIR --ceiling N\n');
    process.exit(64);
  }
  process.stdout.write(`${JSON.stringify(throttledRetry(dir, ceiling))}\n`);
}

module.exports = { throttledRetry };
