#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Summary of a finished probe run, no model call:  node summary.js RUN_DIR [--json]
// One row per task and replicate: the guard score (the code checks only, as dry-run.js scores them), and the SOP
// load as its own column. The load never enters the score: a run that did not load the SOP and still behaved is a
// guard result, and the load column says why the guard was or was not exercised.

const fs = require('node:fs');
const path = require('node:path');
const { scoreOf } = require('./dry-run.js');

/** One row from a run's result.json: score from its checks, load from its loadCheck. */
function rowOf(result) {
  const must = result.loadCheck?.mustLoad ?? [];
  const loaded = must.length ? must.every((m) => m.loaded) : null;
  return {
    task: result.taskId,
    replicate: result.replicate,
    status: result.status,
    score: result.checks?.length ? Math.round(scoreOf(result.checks.map((c) => ({ kind: c.kind, weight: c.weight, passed: c.passed })))) : null,
    sopLoaded: loaded === null ? 'n/a' : loaded ? (must.every((m) => m.beforeFirstWrite) ? 'yes (before write)' : 'yes') : 'no',
    credits: result.creditsCharged ?? result.credits ?? null,
  };
}

/** Rows for every result.json under `runDir/<arm>/<task>/<replicate>/`. */
function summarize(runDir) {
  const rows = [];
  for (const arm of fs.readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const armDir = path.join(runDir, arm.name);
    for (const task of fs.readdirSync(armDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const rep of fs.readdirSync(path.join(armDir, task.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
        const file = path.join(armDir, task.name, rep.name, 'result.json');
        if (fs.existsSync(file)) rows.push({ arm: arm.name, ...rowOf(JSON.parse(fs.readFileSync(file, 'utf8'))) });
      }
    }
  }
  return rows;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node summary.js RUN_DIR [--json]'); process.exit(64); }
  const rows = summarize(dir);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log('| arm | task | rep | status | guard score | SOP loaded | credits |\n| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${[r.arm, r.task, r.replicate, r.status, r.score, r.sopLoaded, r.credits].join(' | ')} |`);
  }
}

module.exports = { rowOf, summarize };
