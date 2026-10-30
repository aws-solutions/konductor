// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('./schema.js');
const real = require('./real.js');

const BENCH_DIR = path.join(__dirname, '..', '..');

// Enforced when neither the CLI nor the suite file says otherwise.
const SUITE_DEFAULTS = {
  lite: { arms: ['vanilla', 'v1.2.0', 'main'], replicates: 1, parallel: 1 },
  full: { arms: ['vanilla', 'v1.0.0', 'v1.1.0', 'v1.2.0', 'main'], replicates: 3, parallel: 3 },
  hard: { arms: ['vanilla', 'v1.2.0', 'main'], replicates: 3, parallel: 1 },
  real: { arms: ['vanilla', 'v1.2.0', 'main'], replicates: 1, parallel: 1 },
  autonomy: { arms: ['vanilla', 'v1.2.0', 'main'], replicates: 3, parallel: 1 },
  // Tasks borrowed from the other suites; each keeps its own tier and gains "pilot".
  pilot: { arms: ['vanilla', 'v1.2.0', 'main'], replicates: 1, parallel: 1 },
  // Capability trigger and lift runs. `cap` commands always name their arms; this default is only a fallback.
  cap: { arms: ['v1.2.0'], replicates: 1, parallel: 1 },
};
const SUITE_NAMES = Object.keys(SUITE_DEFAULTS);

// Reads every task file of one directory into `tasks`. Fixtures come from `fixtureRoots` (first hit wins) and
// hidden test directories from `hiddenRoot`.
function readTaskDir({ dir, tasks, schema, benchDir, fixtureRoots, hiddenRoot, allowReal, extra }) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const task = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const errors = validate(schema, task);
    if (errors.length) throw new Error(`invalid task file ${file}:\n  ${errors.join('\n  ')}`);
    if (tasks.has(task.id)) throw new Error(`duplicate task id ${task.id} (${file})`);
    if (task.real !== undefined) {
      if (!allowReal) throw new Error(`task ${task.id}: real tasks cannot come from an extra tasks directory`);
      // The base tree comes from the real-repository cache and is built on first use, so loading never needs the cache.
      try { real.attach(task, benchDir); } catch (e) { throw new Error(`task ${task.id}: ${e.message}`); }
    } else {
      if (task.fixture === undefined) throw new Error(`task ${task.id}: needs a fixture or a real reference`);
      task.fixtureDir = fixtureRoots.map((r) => path.join(r, task.fixture)).find((d) => fs.existsSync(d)) ?? path.join(fixtureRoots[0], task.fixture);
      if (!fs.existsSync(task.fixtureDir)) throw new Error(`task ${task.id}: fixture dir missing: ${task.fixtureDir}`);
    }
    if (task.hidden !== undefined) {
      task.hiddenDir = path.join(hiddenRoot, task.hidden);
      if (!fs.existsSync(task.hiddenDir)) throw new Error(`task ${task.id}: hidden dir missing: ${task.hiddenDir}`);
    }
    if (extra) task.extraDir = extra;
    tasks.set(task.id, task);
  }
}

/**
 * Loads bench/tasks, then each directory of `extraDirs`: `<dir>/<id>.json` tasks, `<dir>/fixtures/<name>` (falling back
 * to bench/fixtures) and `<dir>/hidden/<name>`. A task id may appear only once across all of them.
 */
function loadTasks(benchDir = BENCH_DIR, { extraDirs = [] } = {}) {
  const schema = loadSchema('task');
  const tasks = new Map();
  readTaskDir({ dir: path.join(benchDir, 'tasks'), tasks, schema, benchDir, fixtureRoots: [path.join(benchDir, 'fixtures')], hiddenRoot: path.join(benchDir, 'tasks', 'hidden'), allowReal: true });
  for (const raw of extraDirs) {
    const dir = path.resolve(raw);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--extra-tasks directory not found: ${dir}`);
    readTaskDir({ dir, tasks, schema, benchDir, fixtureRoots: [path.join(dir, 'fixtures'), path.join(benchDir, 'fixtures')], hiddenRoot: path.join(dir, 'hidden'), allowReal: false, extra: dir });
  }
  return tasks;
}

// Everything under the bench directory that the agent must never read: fixtures (answer keys),
// reference and partial solutions, keyword stubs, the hidden acceptance tests and the real-repository
// manifest with its fetch tooling.
// An extra tasks directory holds fixtures and hidden tests too, so it is hidden whole.
function benchMask(benchDir = BENCH_DIR, extraDirs = []) {
  return [path.join(benchDir, 'fixtures'), path.join(benchDir, 'real'), ...['hidden', 'partials', 'solutions', 'stubs'].map((d) => path.join(benchDir, 'tasks', d)), ...extraDirs.map((d) => path.resolve(d))];
}

function loadSuite(name, tasks, benchDir = BENCH_DIR) {
  if (!SUITE_DEFAULTS[name]) throw new Error(`unknown suite "${name}" (expected lite, full, hard or real, or autonomy, pilot or cap)`);
  const file = path.join(benchDir, 'suites', `${name}.json`);
  const fromFile = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const taskIds = fromFile.tasks
    || [...tasks.values()].filter((t) => t.tiers.includes(name) && !t.id.startsWith('_')).map((t) => t.id);
  return {
    name,
    taskIds,
    arms: fromFile.arms || SUITE_DEFAULTS[name].arms,
    replicates: fromFile.replicates || SUITE_DEFAULTS[name].replicates,
    parallel: fromFile.parallel || SUITE_DEFAULTS[name].parallel,
    judges: fromFile.judges || [],
  };
}

module.exports = { loadTasks, loadSuite, benchMask, SUITE_DEFAULTS, SUITE_NAMES, BENCH_DIR };
