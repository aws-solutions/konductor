// SPDX-License-Identifier: Apache-2.0
'use strict';

// Re-evaluates a task's current checks against the workspace snapshot a run saved, so a
// corrected check can be applied to old runs without re-running the agent. Only the check
// fields of result.json change; the first-ever check results stay under `checksOriginal`.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChecks } = require('./checks.js');
const { aggregateHidden, aggregateRegression, aggregateGroup } = require('./check-matcher.js');
const { completedWithoutHelp } = require('./autonomy.js');
const { buildCheckEnv } = require('./env.js');
const { loadTasks, BENCH_DIR } = require('./tasks.js');
const real = require('./real.js');
const { makeIsolation, workingMode } = require('./isolate.js');
const { loadRun } = require('../../report/load.js');

const checksRevision = (task) => crypto.createHash('sha256').update(JSON.stringify(task.checks)).digest('hex').slice(0, 12);

function skipReason(result, dir) {
  if (result.status === 'budget_skipped') return 'budget-skipped run';
  if (result.infraError) return 'infrastructure error';
  if (!result.checks?.length && !result.checksOriginal?.length) return 'run has no checks';
  if (!fs.existsSync(path.join(dir, 'workspace'))) return 'no workspace snapshot';
  return null;
}

// Runs in a throwaway copy: a check command that writes files must not alter the snapshot.
function evaluate(dir, task) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recheck-'));
  try {
    const work = path.join(scratch, 'work');
    fs.cpSync(path.join(dir, 'workspace'), work, { recursive: true });
    const { env } = buildCheckEnv(process.env, { home: path.join(scratch, 'home'), tmpdir: path.join(scratch, 'tmp'), konductor: false });
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    const opts = { pristineDir: task.fixtureDir, env, hiddenDir: task.hiddenDir, scratchDir: path.join(scratch, 'check-scratch') };
    if (task.real) {
      // Same conditions as a run: no network and the host copies of the project hidden, when the OS isolation works here.
      opts.real = real.testSpec(task);
      const mode = workingMode();
      if (mode) {
        const iso = makeIsolation({ mode, scratchRoot: scratch, hide: real.hidePaths(task), offline: true });
        opts.wrapCmd = (cmd) => iso.wrap('sh', ['-c', cmd]);
      }
    }
    return runChecks(work, task.checks, opts);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * dir: a run directory holding result.json and workspace/. Returns
 * {status: 'rechecked'|'unchanged'|'skipped', reason?, before, after}.
 */
function recheckRun({ dir, task, dryRun = false, now = () => new Date().toISOString() }) {
  if (!task) throw new Error(`no task definition for ${dir}`);
  const file = path.join(dir, 'result.json');
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const reason = skipReason(result, dir);
  if (reason) return { status: 'skipped', reason, before: result.checks || [], after: null };
  const revision = checksRevision(task);
  const original = result.checksOriginal ?? result.checks;
  if (result.checksRevision === revision) return { status: 'unchanged', before: original, after: result.checks };

  const after = evaluate(dir, task);
  if (!dryRun) {
    const next = {
      ...result,
      checks: after,
      checksOriginal: original,
      checksRevision: revision,
      checksRecheckedAt: now(),
      checksAllPassed: after.length > 0 && after.every((c) => c.passed),
    };
    const hidden = aggregateHidden(after);
    if (hidden || 'hiddenTests' in result) next.hiddenTests = hidden;
    if ('intendedTests' in result || 'invariantTests' in result) {
      next.intendedTests = aggregateGroup(after, 'intended');
      next.invariantTests = aggregateGroup(after, 'invariant');
      next.completedWithoutHelp = result.autonomous === null || result.autonomous === undefined ? result.completedWithoutHelp ?? null : completedWithoutHelp({ autonomous: result.autonomous, intendedTests: next.intendedTests, invariantTests: next.invariantTests });
    }
    const regression = aggregateRegression(after);
    if (regression || 'regressionTests' in result) next.regressionTests = regression;
    writeAtomic(file, JSON.stringify(next, null, 2) + '\n');
  }
  return { status: 'rechecked', before: original, after };
}

function recheckAll({ runDir, benchDir = BENCH_DIR, extraDirs = [], dryRun = false, now }) {
  const run = loadRun(runDir);
  const tasks = loadTasks(benchDir, { extraDirs });
  return run.runs.map((r) => ({
    armId: r.armId, taskId: r.taskId, replicate: r.replicate,
    ...recheckRun({ dir: r.dir, task: tasks.get(r.taskId), dryRun, now }),
  }));
}

module.exports = { recheckRun, recheckAll, checksRevision };
