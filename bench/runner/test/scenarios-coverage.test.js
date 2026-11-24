// SPDX-License-Identifier: Apache-2.0
'use strict';

// The SR-32 split and the coverage matrix, on a small fake konductor tree and task lists.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { splitOf, hashOf } = require('../../scenarios/split.js');
const { buildCoverage, renderCoverageMd, PHASES, CORE_PHASES, ADDED_PHASES, ROLES, TARGET, PHASE_LABEL } = require('../../scenarios/coverage.js');
const { scanRepo, loadAgentSpecs } = require('../../cap/scan.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// Ids with a known split, found by search so the test does not depend on a hard-coded hash.
const ids = (split, n, prefix) => {
  const out = [];
  for (let i = 0; out.length < n; i++) if (splitOf(`${prefix}-${i}`) === split) out.push(`${prefix}-${i}`);
  return out;
};

function tree() {
  const dir = tmp();
  write(path.join(dir, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: Use when alpha.\n---\n\n# A\n');
  write(path.join(dir, 'skills/beta/SKILL.md'), '---\nname: beta\ndescription: Use when beta.\n---\n\n# B\n');
  write(path.join(dir, 'agent-sops/k-plan.sop.md'), '# Plan\n\n## Overview\n\nPlans.\n');
  write(path.join(dir, 'agents/konductor.agent-spec.json'), JSON.stringify({ name: 'konductor', config: { description: 'x' }, dependencies: { skills: { skillNames: ['alpha'] }, agentSops: { agentSopNames: ['k-plan'] } } }));
  return dir;
}

test('the split follows the SR-32 rule: the first 8 hex digits of the salted sha256, divisible by 3 is DEV', () => {
  assert.equal(typeof hashOf('x'), 'number');
  for (const id of ['a', 'b', 'c', 'sdlc-problem-framing', 'hard-export-formats']) assert.equal(splitOf(id), hashOf(id) % 3 === 0 ? 'DEV' : 'HELD-OUT');
  // The recorded rule, recomputed independently of the module.
  const want = parseInt(require('node:crypto').createHash('sha256').update('konductor-2x2 SR-32 split v1:' + 'abc').digest('hex').slice(0, 8), 16) % 3 === 0 ? 'DEV' : 'HELD-OUT';
  assert.equal(splitOf('abc'), want);
});

test('the target matrix sums to the plan: 131 real tasks over the 15 core phases, 8 to 11 per phase', () => {
  const total = CORE_PHASES.reduce((n, p) => n + ROLES.reduce((m, r) => m + TARGET[p][r], 0), 0);
  assert.equal(total, 131);
  const roles = Object.fromEntries(ROLES.map((r) => [r, CORE_PHASES.reduce((n, p) => n + TARGET[p][r], 0)]));
  assert.deepEqual(roles, { pm: 13, tpm: 12, architect: 24, developer: 36, frontend: 8, qa: 8, security: 8, sre: 10, reviewer: 12 });
});

test('the three added phases (T13) sit after the core ones, each with a label and a two-task target, and count in the matrix', () => {
  assert.deepEqual(ADDED_PHASES, ['documentation', 'triage', 'log-analysis']);
  assert.deepEqual(PHASES, [...CORE_PHASES, ...ADDED_PHASES]);
  for (const p of ADDED_PHASES) {
    assert.equal(typeof PHASE_LABEL[p], 'string');
    assert.equal(ROLES.reduce((n, r) => n + TARGET[p][r], 0), 2);
  }
  const scan = new Map();
  const tasks = [
    { id: 't13-doc-a', prompt: 'p', phase: 'documentation', role: 'developer' },
    { id: 't13-log-a', prompt: 'p', phase: 'log-analysis', role: 'security' },
  ];
  const cov = buildCoverage({ tasks, scan });
  assert.equal(cov.matrix.cells.documentation.developer.count, 1);
  assert.equal(cov.matrix.phaseTotals['log-analysis'].count, 1);
  assert.ok(cov.shortfalls.includes('phase triage has 0 tasks, needs 8'));
});

function fixtureTasks() {
  const dev = ids('DEV', 3, 'd');
  const held = ids('HELD-OUT', 4, 'h');
  const task = (id, o = {}) => ({ id, prompt: 'p', phase: 'bugfix', role: 'developer', ...o });
  return [
    task(dev[0], { targetSkills: ['alpha'] }), task(held[0], { targetSkills: ['alpha'] }), task(held[1], { targetSkills: ['alpha'], effectSubset: true }),
    task(held[2], { controlKind: 'twin', twinOf: dev[0], phase: 'bugfix', role: 'developer' }),
    task(dev[1], { targetSop: 'k-plan', phase: 'planning', role: 'tpm' }), task(held[3], { targetSop: 'k-plan', phase: 'planning', role: 'tpm' }),
    task(dev[2], { controlKind: 'negative', loadCheck: { mustNotLoad: ['beta', 'skill:k-plan'] } }),
  ];
}

test('a unit with 3 targeted tasks (2 held-out) and a twin is covered; fewer is a hole; an approved reason makes it selection-only', () => {
  const dir = tree();
  const cov = buildCoverage({ tasks: fixtureTasks(), scan: scanRepo(dir), specs: loadAgentSpecs(dir), selectionOnly: { 'skill:beta': 'needs a browser', 'skill:gone': 'stale' } });
  const by = Object.fromEntries(cov.units.map((u) => [u.id, u]));
  assert.equal(by['skill:alpha'].status, 'covered');
  assert.deepEqual(by['skill:alpha'].owners, ['konductor']);
  assert.deepEqual(by['skill:alpha'].controls.length, 1);
  assert.equal(by['skill:alpha'].effect.length, 1);
  assert.equal(by['sop:k-plan'].status, 'hole');
  assert.match(by['sop:k-plan'].missing.join(';'), /2 of 3 targeted/);
  assert.equal(by['skill:beta'].status, 'selection-only');
  assert.equal(by['skill:beta'].reason, 'needs a browser');
  assert.equal(by['agent:konductor'].status, 'hole');
  assert.deepEqual(cov.holes, ['agent:konductor', 'sop:k-plan']);
  assert.ok(cov.notes.some((n) => /skill:gone names no unit/.test(n)));
  assert.deepEqual(cov.summary, { units: 4, covered: 1, selectionOnly: 1, holes: 2 });
});

test('a control counts for a unit through mustNotLoad (kind prefix allowed) or through the twin of a task that targets it', () => {
  const dir = tree();
  const cov = buildCoverage({ tasks: fixtureTasks(), scan: scanRepo(dir), specs: [] });
  const by = Object.fromEntries(cov.units.map((u) => [u.id, u]));
  assert.equal(by['skill:beta'].controls.length, 1);
  assert.equal(by['sop:k-plan'].controls.length, 1);
  assert.equal(by['skill:alpha'].controls.length, 1);
});

test('the matrix counts only real tasks, by main phase and role, and flags phases and roles under their minimum', () => {
  const dir = tree();
  const cov = buildCoverage({ tasks: fixtureTasks(), scan: scanRepo(dir) });
  assert.equal(cov.tasks.real, 5);
  assert.equal(cov.tasks.twins, 1);
  assert.equal(cov.tasks.negatives, 1);
  assert.deepEqual(cov.matrix.cells.bugfix.developer, { count: 3, target: 6 });
  assert.deepEqual(cov.matrix.cells.planning.tpm, { count: 2, target: 7 });
  assert.equal(cov.matrix.phaseTotals.bugfix.heldOut, 2);
  assert.ok(cov.shortfalls.includes('phase bugfix has 3 tasks, needs 8'));
  assert.ok(cov.shortfalls.includes('role developer has 3 real tasks, needs 8'));
});

test('a real task with no phase or role is noted and not counted', () => {
  const cov = buildCoverage({ tasks: [{ id: 'old', prompt: 'p' }], scan: scanRepo(tree()) });
  assert.equal(cov.tasks.real, 1);
  assert.ok(cov.notes.some((n) => /no phase or role.*old/.test(n)));
  assert.equal(cov.matrix.phaseTotals.bugfix.count, 0);
});

test('coverage.md shows both views and the status of each unit', () => {
  const dir = tree();
  const md = renderCoverageMd(buildCoverage({ tasks: fixtureTasks(), scan: scanRepo(dir), specs: loadAgentSpecs(dir), selectionOnly: { 'skill:beta': 'needs a browser' }, base: { label: 'dir:x', commitSha: null } }));
  assert.match(md, /## Phase by role/);
  assert.match(md, /\| Bug fix \| .*3\/6/);
  assert.match(md, /\| skill:alpha \| konductor \|.*\| covered \|/);
  assert.match(md, /selection-only: needs a browser/);
  assert.match(md, /hole: 2 of 3 targeted tasks/);
});

test('the CLI writes coverage.json and coverage.md, reads selection-only.json, and --fail-on-hole exits 1', () => {
  const dir = tree();
  const pack = tmp();
  for (const t of fixtureTasks()) write(path.join(pack, 'b1', `${t.id}.json`), JSON.stringify(t));
  write(path.join(pack, 'selection-only.json'), JSON.stringify({ 'skill:beta': 'needs a browser' }));
  const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: tmp() } });
  const r = cli(['scenarios', 'coverage', pack, '--base', `dir:${dir}`]);
  assert.equal(r.status, 0, r.stderr);
  const cov = JSON.parse(fs.readFileSync(path.join(pack, 'coverage.json'), 'utf8'));
  assert.equal(cov.summary.holes, 2);
  assert.equal(cov.units.find((u) => u.id === 'skill:beta').status, 'selection-only');
  assert.ok(fs.existsSync(path.join(pack, 'coverage.md')));
  // A second run reads the same tasks: the generated files are not tasks.
  const again = cli(['scenarios', 'coverage', pack, '--base', `dir:${dir}`, '--fail-on-hole']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /hole: sop:k-plan/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pack, 'coverage.json'), 'utf8')).tasks.total, 7);
  const bad = tmp();
  write(path.join(bad, 'selection-only.json'), JSON.stringify({ 'skill:x': '' }));
  assert.equal(cli(['scenarios', 'coverage', bad, '--base', `dir:${dir}`]).status, 2);
});
