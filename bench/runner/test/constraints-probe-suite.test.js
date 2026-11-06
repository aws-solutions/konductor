// SPDX-License-Identifier: Apache-2.0
'use strict';

// The constraints-probe suite: registration, extra-directory resolution, the manifest that ties tasks to agents,
// and the proofs every task needs (the reference solution passes, the untouched fixture does not, the negatives hold).
// No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks } = require('../lib/checks.js');
const { copyFixture } = require('../lib/sandbox.js');
const { buildCheckEnv } = require('../lib/env.js');
const { loadTasks, loadSuite, suiteExtraDirs, mergeExtraDirs, benchMask, SUITE_NAMES, BENCH_DIR } = require('../lib/tasks.js');
const { loadCases, checkCases } = require('../lib/negatives.js');
const { mkScratch } = require('./scratch.js');

const PROBES = path.join(BENCH_DIR, 'probes');
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, 'suites', 'constraints-probe.manifest.json'), 'utf8'));
const tasks = loadTasks(BENCH_DIR, { extraDirs: [PROBES] });
const suite = loadSuite('constraints-probe', tasks, BENCH_DIR);

test('constraints-probe is a registered suite with five replicates and one run at a time', () => {
  assert.ok(SUITE_NAMES.includes('constraints-probe'));
  assert.equal(suite.replicates, 5);
  assert.equal(suite.parallel, 1);
  assert.equal(suite.taskIds.length, 8);
});

test('the suite resolves bench/probes without the flag, the flag is not counted twice, and the directory is hidden', () => {
  const dirs = suiteExtraDirs('constraints-probe', BENCH_DIR);
  assert.deepEqual(dirs, [PROBES]);
  assert.deepEqual(mergeExtraDirs(dirs, [PROBES]), [PROBES]);
  assert.ok(benchMask(BENCH_DIR, dirs).includes(PROBES));
  for (const id of suite.taskIds) assert.ok(tasks.has(id), id);
});

test('the manifest lists exactly the suite tasks, and every group task exists', () => {
  assert.deepEqual(Object.keys(manifest.tasks).sort(), [...suite.taskIds].sort());
  for (const g of manifest.groups) for (const id of [...g.u, ...g.canary]) assert.ok(manifest.tasks[id], `${g.entry}: ${id}`);
});

test('each unprompted-rule task is owned by the agent the manifest says, and each owner has its own entry group', () => {
  const entries = manifest.groups.map((g) => g.entry);
  for (const [id, t] of Object.entries(manifest.tasks)) {
    if (t.owner) assert.ok(entries.includes(t.owner), `${id} owner ${t.owner} has no entry group`);
    if (t.probe === 'U1') assert.ok(t.pairing?.primary, `${id} needs a pairing`);
  }
  const delegated = manifest.groups.find((g) => g.position === 'delegated');
  const uTasks = Object.entries(manifest.tasks).filter(([, t]) => t.probe !== 'canary').map(([id]) => id).sort();
  assert.deepEqual([...delegated.u].sort(), uTasks, 'the orchestrator group runs every rule task once');
  for (const g of manifest.groups.filter((x) => x.position === 'entry')) {
    for (const id of g.u) assert.equal(manifest.tasks[id].owner, g.entry, `${id} runs under ${g.entry}`);
  }
});

test('no prompt mentions the rules, the skill, the checker, the circuit breaker or the severity scale', () => {
  const banned = /constraint|maker|checker|circuit|fingerprint|\brules?\b|skill|CRITICAL|IMPORTANT|SUGGESTION|root[- ]cause|third fix/i;
  for (const id of suite.taskIds) assert.doesNotMatch(tasks.get(id).prompt, banned, id);
});

test('only the canary prompt mentions a canary', () => {
  for (const id of suite.taskIds) {
    const has = /canary/i.test(tasks.get(id).prompt);
    assert.equal(has, id === 'probe-canary', id);
  }
});

test('each fixture keeps its answer key and stays small', () => {
  for (const name of new Set(suite.taskIds.map((id) => tasks.get(id).fixture))) {
    const dir = path.join(PROBES, 'fixtures', name);
    assert.ok(fs.existsSync(path.join(dir, '.bench-answer-key.md')), name);
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(e.name)));
    walk(dir);
    assert.ok(files.filter((f) => f !== '.bench-answer-key.md').length <= 15, `${name} has too many files`);
  }
});

const runIn = (task, dir) => {
  const { env } = buildCheckEnv(process.env, { home: path.join(dir, '.home') });
  fs.mkdirSync(env.TMPDIR, { recursive: true });
  return runChecks(dir, task.checks, { pristineDir: task.fixtureDir, env });
};

for (const id of [...new Set(Object.keys(manifest.tasks))]) {
  test(`reference solution passes every check, the untouched fixture does not: ${id}`, () => {
    const task = tasks.get(id);
    const solved = mkScratch('probe-sol-');
    const bare = mkScratch('probe-bare-');
    try {
      copyFixture(task.fixtureDir, solved);
      fs.cpSync(path.join(PROBES, 'solutions', id), solved, { recursive: true });
      assert.deepEqual(runIn(task, solved).filter((c) => !c.passed), []);
      copyFixture(task.fixtureDir, bare);
      assert.ok(runIn(task, bare).some((c) => !c.passed), 'doing nothing must not pass');
    } finally {
      fs.rmSync(solved, { recursive: true, force: true });
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  const negatives = path.join(PROBES, 'negatives');
  if (fs.existsSync(path.join(negatives, `${id}.json`))) {
    test(`near-miss negatives and positives hold: ${id}`, () => {
      const task = tasks.get(id);
      const problems = checkCases({
        task, spec: loadCases(negatives, id),
        makeWorkspace: () => {
          const dir = mkScratch('probe-neg-');
          copyFixture(task.fixtureDir, dir);
          fs.cpSync(path.join(PROBES, 'solutions', id), dir, { recursive: true });
          return dir;
        },
        evalOne: (dir, check) => {
          const { env } = buildCheckEnv(process.env, { home: path.join(dir, '.home') });
          return runChecks(dir, [check], { pristineDir: task.fixtureDir, env })[0].passed;
        },
      });
      assert.deepEqual(problems, []);
    });
  }
}

test('a wrong fix of the cache task fails the behavior check while the note check can still pass', () => {
  const task = tasks.get('probe-u3-circuit-breaker');
  const dir = mkScratch('probe-wrong-');
  try {
    copyFixture(task.fixtureDir, dir);
    fs.writeFileSync(path.join(dir, 'src/cache.js'), fs.readFileSync(path.join(dir, 'src/cache.js'), 'utf8').replace('> this.ttlMs', '>= this.ttlMs'));
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'Changed the cache comparison to >= for the ttl config.\n');
    const failed = runIn(task, dir).filter((c) => !c.passed).map((c) => c.type + (c.cmd ? `:${c.cmd.slice(0, 20)}` : ''));
    assert.ok(failed.length >= 2 && failed.length < task.checks.length, failed.join(' | '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
