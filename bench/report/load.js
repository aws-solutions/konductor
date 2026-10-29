// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runtimeOf } = require('../runner/lib/harness/runtime.js');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Run layout: <runDir>/<arm>/<task>/<replicate>/result.json. Other directories
// (probes, caches) have no result.json at that depth and are ignored.
function loadRun(runDir) {
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir)) throw new Error(`run directory not found: ${runDir}`);
  const subdirs = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const runs = [];
  for (const arm of subdirs(dir)) {
    for (const task of subdirs(path.join(dir, arm))) {
      for (const rep of subdirs(path.join(dir, arm, task))) {
        const file = path.join(dir, arm, task, rep, 'result.json');
        if (fs.existsSync(file)) {
          runs.push({ armId: arm, taskId: task, replicate: Number(rep), dir: path.dirname(file), result: readJson(file) });
        }
      }
    }
  }
  if (!runs.length) throw new Error(`no result.json files found under ${runDir}`);
  // One harness per run: kiro-cli and opencode report different cost units, so they never share a table.
  const harnesses = [...new Set(runs.map((r) => runtimeOf(r.result)))].sort();
  if (harnesses.length > 1) throw new Error(`run directory mixes harnesses (${harnesses.join(', ')}); report each harness from its own run`);
  const cfgFile = path.join(dir, 'run-config.json');
  const judgFile = path.join(dir, 'judgments.json');
  return {
    dir,
    harness: harnesses[0],
    config: fs.existsSync(cfgFile) ? readJson(cfgFile) : {},
    runs,
    judgments: fs.existsSync(judgFile) ? readJson(judgFile) : null,
  };
}

module.exports = { loadRun, readJson };
