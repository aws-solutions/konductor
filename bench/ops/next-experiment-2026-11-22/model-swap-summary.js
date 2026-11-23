#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free, read-only: the skill-load table of run-model-swap.sh, one row per model and arm.
//
//   node model-swap-summary.js BENCH GROUP...
//
// BENCH  the bench checkout whose `cap nudge-check` reader is used (bench/cap/nudgecli.js checkRuns)
// GROUP  model|arm|tasks|cell,cell,...  where each cell is one run dir holding result.json
//
// Per run, from the same reader as `cap nudge-check`: a task skill loaded (any get_skill other than
// delegation-protocol, which konductor loads to spawn helpers), loaded whole (a task skill whose text came back in
// full), preview only (a load cut to kiro-cli's 30,000-character preview), find_skills calls, and "no skill fits" in
// the final text. Also counts runs whose result.json flags a model mismatch. Cells that never ran are left out.
// Groups with no cell are left out. Prints markdown. No model call.

const fs = require('node:fs');
const path = require('node:path');

const HELPER_SKILL = 'delegation-protocol';

/** Row counts for one group's cells, read with `checkRuns`. */
function countGroup(checkRuns, cells) {
  const n = { runs: 0, loaded: 0, whole: 0, preview: 0, find: 0, noFit: 0, mismatch: 0 };
  for (const dir of cells) {
    for (const r of checkRuns([dir])) {
      if (!r.ran) continue;
      const res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
      n.runs++;
      if (r.skillsLoaded.some((s) => s !== HELPER_SKILL)) n.loaded++;
      if (r.skillsLoadedFull.some((s) => s !== HELPER_SKILL)) n.whole++;
      if (r.skillLoadsPreview > 0) n.preview++;
      n.find += r.findSkillsCalls;
      if (r.saidNoSkillFits) n.noFit++;
      if ((res.flags ?? []).includes('modelMismatch')) n.mismatch++;
    }
  }
  return n;
}

function render(rows) {
  const out = [
    '| model | arm | tasks | runs | runs with a task skill loaded | loaded whole | preview only | find_skills calls | said no skill fits | model mismatch |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const { model, arm, tasks, n } of rows) {
    out.push(`| ${model} | ${arm} | ${tasks} | ${n.runs} | ${n.loaded} | ${n.whole} | ${n.preview} | ${n.find} | ${n.noFit} | ${n.mismatch} |`);
  }
  return out.join('\n') + '\n';
}

if (require.main === module) {
  const [bench, ...groups] = process.argv.slice(2);
  if (!bench || !groups.length) { console.error('usage: node model-swap-summary.js BENCH model|arm|tasks|cell,cell...'); process.exit(64); }
  const { checkRuns } = require(path.join(bench, 'bench/cap/nudgecli.js'));
  const rows = [];
  for (const g of groups) {
    const [model, arm, tasks, cells] = g.split('|');
    const dirs = (cells ?? '').split(',').filter((d) => d && fs.existsSync(path.join(d, 'result.json')));
    if (dirs.length) rows.push({ model, arm, tasks, n: countGroup(checkRuns, dirs) });
  }
  process.stdout.write(render(rows));
}

module.exports = { countGroup, render };
