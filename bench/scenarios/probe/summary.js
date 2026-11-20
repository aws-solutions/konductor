#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Summary of a finished probe run, no model call:  node summary.js RUN_DIR [--json]
// One row per task and replicate: the guard score (the code checks only, as the shared dry run scores them), and the SOP
// load as its own column. The load never enters the score: a run that did not load the SOP and still behaved is a
// guard result, and the load column says why the guard was or was not exercised.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { codeScore } = require('../lib/score.js');

/** One row from a run's result.json: score from its checks, load from its loadCheck. */
function rowOf(result) {
  const must = result.loadCheck?.mustLoad ?? [];
  const loaded = must.length ? must.every((m) => m.loaded) : null;
  return {
    task: result.taskId,
    replicate: result.replicate,
    status: result.status,
    score: result.checks?.length ? Math.round(codeScore(result.checks.map((c) => ({ kind: c.kind, weight: c.weight, passed: c.passed }))).score) : null,
    sopLoaded: loaded === null ? 'n/a' : loaded ? (must.every((m) => m.beforeFirstWrite) ? 'yes (before write)' : 'yes') : 'no',
    credits: Number((result.creditsCharged ?? result.credits ?? 0).toFixed(2)) || null,
    note: result.status === 'budget_skipped' ? `skipped: ${result.error}` : result.creditOvershoot > 0 ? `over the run limit by ${result.creditOvershoot.toFixed(1)}` : '',
  };
}

/** Observation, not score: the branches (other than the default branch) the agent pushed to the fixture's local remote. */
function pushedBranches(runCellDir) {
  const remote = path.join(runCellDir, 'workspace', 'remote.git');
  if (!fs.existsSync(remote)) return 'n/a';
  const out = execFileSync('git', [`--git-dir=${remote}`, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  const extra = out.split('\n').filter((b) => b && b !== 'main');
  return extra.length ? extra.join(', ') : 'none';
}

/** Rows for every result.json under `runDir/<arm>/<task>/<replicate>/`. */
function summarize(runDir) {
  const rows = [];
  for (const arm of fs.readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const armDir = path.join(runDir, arm.name);
    for (const task of fs.readdirSync(armDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const rep of fs.readdirSync(path.join(armDir, task.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
        const file = path.join(armDir, task.name, rep.name, 'result.json');
        if (fs.existsSync(file)) rows.push({ arm: arm.name, ...rowOf(JSON.parse(fs.readFileSync(file, 'utf8'))), pushedBranches: pushedBranches(path.dirname(file)) });
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
    console.log('| arm | task | rep | status | guard score | SOP loaded | credits | pushed branches (observation) | note |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${[r.arm, r.task, r.replicate, r.status, r.score, r.sopLoaded, r.credits, r.pushedBranches, r.note].join(' | ')} |`);
  }
}

module.exports = { rowOf, pushedBranches, summarize };
