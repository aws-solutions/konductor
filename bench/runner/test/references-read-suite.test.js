// SPDX-License-Identifier: Apache-2.0
'use strict';

// The references-read suite: registration, extra-directory resolution, the manifest that ties tasks to arms and entry
// agents, and the proofs every task needs (the reference solution passes, the untouched fixture does not, the
// negatives hold). The planted facts are checked against the files they were taken from when the pinned commits are
// present in this checkout. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runChecks } = require('../lib/checks.js');
const { copyFixture } = require('../lib/sandbox.js');
const { buildCheckEnv } = require('../lib/env.js');
const { loadTasks, loadSuite, suiteExtraDirs, mergeExtraDirs, benchMask, SUITE_NAMES, BENCH_DIR } = require('../lib/tasks.js');
const { loadCases, checkCases } = require('../lib/negatives.js');
const { factPresent, plantedOf } = require('../../report/refs.js');
const { mkScratch } = require('./scratch.js');

const REFS = path.join(BENCH_DIR, 'refs');
const REPO = path.resolve(BENCH_DIR, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, 'suites', 'references-read.manifest.json'), 'utf8'));
const tasks = loadTasks(BENCH_DIR, { extraDirs: [REFS] });
const suite = loadSuite('references-read', tasks, BENCH_DIR);

test('references-read is a registered suite with three replicates and one run at a time', () => {
  assert.ok(SUITE_NAMES.includes('references-read'));
  assert.equal(suite.replicates, 3);
  assert.equal(suite.parallel, 1);
  assert.equal(suite.taskIds.length, 3);
});

test('the suite resolves bench/refs without the flag, the flag is not counted twice, and the directory is hidden', () => {
  const dirs = suiteExtraDirs('references-read', BENCH_DIR);
  assert.deepEqual(dirs, [REFS]);
  assert.deepEqual(mergeExtraDirs(dirs, [REFS]), [REFS]);
  assert.ok(benchMask(BENCH_DIR, dirs).includes(REFS));
  for (const id of suite.taskIds) assert.ok(tasks.has(id), id);
});

test('the manifest lists exactly the suite tasks, and every group and arm refers to something that exists', () => {
  assert.deepEqual(Object.keys(manifest.tasks).sort(), [...suite.taskIds].sort());
  for (const g of manifest.groups) {
    assert.ok(manifest.arms[g.arm], `group arm ${g.arm}`);
    for (const id of g.tasks) {
      assert.ok(manifest.tasks[id], `${g.arm}: ${id}`);
      assert.equal(manifest.tasks[id].owner, g.entry, `${id} runs under ${g.entry}`);
    }
  }
  for (const [name, a] of Object.entries(manifest.arms)) {
    assert.ok(manifest.refs[a.ref], `${name} ref ${a.ref}`);
    assert.ok(['control', 'reference', 'readable'].includes(a.role), `${name} role`);
    assert.ok(manifest.groups.some((g) => g.arm === name), `${name} has a group`);
  }
  for (const [k, r] of Object.entries(manifest.refs)) assert.match(r.sha, /^[0-9a-f]{40}$/, `${k} is a full commit id`);
});

test('a forced group names a prefix skill and an unforced group does not; the readable arm runs only the readable task', () => {
  for (const g of manifest.groups) assert.equal(Boolean(g.prefixSkill), manifest.arms[g.arm].forced, g.arm);
  for (const g of manifest.groups) assert.equal(g.tasks.includes('refs-dynamodb-readable'), manifest.arms[g.arm].role === 'readable', g.arm);
});

test('no prompt mentions references, skills, files in a skill folder, the standards source, or an agent', () => {
  const banned = /references?\/|\breferences?\b|skill|SKILL|get_skill|\bk-[a-z-]+|konductor|\bSOP\b|aws-best-practices|asana\.md/i;
  for (const id of suite.taskIds) assert.doesNotMatch(tasks.get(id).prompt, banned, id);
});

test('each fixture keeps its answer key and stays small', () => {
  for (const name of new Set(suite.taskIds.map((id) => tasks.get(id).fixture))) {
    const dir = path.join(REFS, 'fixtures', name);
    assert.ok(fs.existsSync(path.join(dir, '.bench-answer-key.md')), name);
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(e.name)));
    walk(dir);
    assert.ok(files.filter((f) => f !== '.bench-answer-key.md').length <= 15, `${name} has too many files`);
  }
});

test('the fixtures do not carry the planted facts, so a hit in an answer came from somewhere else', () => {
  for (const [id, spec] of Object.entries(manifest.tasks)) {
    const dir = path.join(REFS, 'fixtures', tasks.get(id).fixture);
    const text = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name !== '.bench-answer-key.md' && !p.includes(`${path.sep}references${path.sep}`)) text.push(fs.readFileSync(p, 'utf8'));
    });
    walk(dir);
    assert.equal(plantedOf(spec, text.join('\n')).used, false, id);
  }
});

const runIn = (task, dir) => {
  const { env } = buildCheckEnv(process.env, { home: path.join(dir, '.home') });
  fs.mkdirSync(env.TMPDIR, { recursive: true });
  return runChecks(dir, task.checks, { pristineDir: task.fixtureDir, env });
};

for (const id of Object.keys(manifest.tasks)) {
  test(`reference solution passes every check and carries the primary planted fact, the untouched fixture does not pass: ${id}`, () => {
    const task = tasks.get(id);
    const solved = mkScratch('refs-sol-');
    const bare = mkScratch('refs-bare-');
    try {
      copyFixture(task.fixtureDir, solved);
      fs.cpSync(path.join(REFS, 'solutions', id), solved, { recursive: true });
      assert.deepEqual(runIn(task, solved).filter((c) => !c.passed), []);
      const artifact = fs.readFileSync(path.join(solved, manifest.tasks[id].artifact), 'utf8');
      assert.equal(plantedOf(manifest.tasks[id], artifact).used, true);
      copyFixture(task.fixtureDir, bare);
      assert.ok(runIn(task, bare).some((c) => !c.passed), 'doing nothing must not pass');
    } finally {
      fs.rmSync(solved, { recursive: true, force: true });
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test(`near-miss negatives and positives hold: ${id}`, () => {
    const task = tasks.get(id);
    const negatives = path.join(REFS, 'negatives');
    const problems = checkCases({
      task, spec: loadCases(negatives, id),
      makeWorkspace: () => {
        const dir = mkScratch('refs-neg-');
        copyFixture(task.fixtureDir, dir);
        fs.cpSync(path.join(REFS, 'solutions', id), dir, { recursive: true });
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

test('the planted facts reject near misses: a different shard range, a different board number, subtasks that move along', () => {
  const dyn = manifest.tasks['refs-dynamodb-design'];
  assert.equal(plantedOf(dyn, 'Shard suffix range 1 to 64, hash(eventId) % 64.').used, false);
  assert.equal(plantedOf(dyn, 'The API returns 200 for a good request.').used, false);
  assert.equal(plantedOf(dyn, 'We shard the day key over 200 suffixes.').used, true);
  assert.equal(plantedOf(dyn, 'The suffix is hash(eventId) % 200 + 1.').used, true);
  assert.equal(plantedOf(dyn, 'At most 5 GSIs per table.').facts['gsi-max-5'], true);
  assert.equal(plantedOf(dyn, 'At most 20 GSIs per table.').facts['gsi-max-5'], false);
  const sprint = manifest.tasks['refs-sprint-capacity'];
  assert.equal(plantedOf(sprint, 'The recreated task loses its subtasks, so the board shows 22 of 27.').used, true);
  assert.equal(plantedOf(sprint, 'The subtasks move along, so the board shows 27 of 27.').used, false);
  assert.equal(plantedOf(sprint, 'The subtasks are lost. The board shows 27.').used, false);
  assert.equal(factPresent({ all: ['a', 'b'] }, 'a only'), false);
});

// The planted facts must live in the reference file and not in the SKILL.md body of the same skill, and must be inline on main.
const have = (sha, file) => { try { execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${sha}:${file}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const show = (sha, file) => execFileSync('git', ['-C', REPO, 'show', `${sha}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 });

test('dynamodb-design: the shard range is in the reference at the PR 155 head and not in its SKILL.md, and is inline on main', (t) => {
  const pr = manifest.refs.pr155.sha;
  const main = manifest.refs.main.sha;
  if (!have(pr, 'skills/dynamodb-design/references/aws-best-practices.md') || !have(main, 'skills/dynamodb-design/SKILL.md')) return t.skip('pinned commits are not in this checkout');
  const spec = manifest.tasks['refs-dynamodb-design'];
  const primary = spec.planted.find((f) => f.primary);
  const asLines = (text) => text.split('\n').filter((l) => new RegExp(primary.pattern, 'i').test(l));
  assert.ok(asLines(show(pr, 'skills/dynamodb-design/references/aws-best-practices.md')).length > 0, 'in the reference');
  assert.equal(asLines(show(pr, 'skills/dynamodb-design/SKILL.md')).length, 0, 'not in the slim body');
  assert.ok(asLines(show(main, 'skills/dynamodb-design/SKILL.md')).length > 0, 'inline on main');
});

test('sprint-planning: the recreate-and-lose rule is in the reference at the Asana fold and not in its SKILL.md, and is inline on main', (t) => {
  const asana = manifest.refs.asana.sha;
  const main = manifest.refs.main.sha;
  if (!have(asana, 'skills/sprint-planning/references/asana.md') || !have(main, 'skills/asana-sprint-planning/SKILL.md')) return t.skip('pinned commits are not in this checkout');
  const lost = /recreate[^.\n]*tasks[^.\n]*new section|lost on the new task|loses task history, comments, attachments, subtasks/i;
  assert.match(show(asana, 'skills/sprint-planning/references/asana.md'), lost);
  assert.doesNotMatch(show(asana, 'skills/sprint-planning/SKILL.md'), lost);
  assert.match(show(main, 'skills/asana-sprint-planning/SKILL.md'), lost);
});
