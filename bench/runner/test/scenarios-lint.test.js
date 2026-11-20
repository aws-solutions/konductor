// SPDX-License-Identifier: Apache-2.0
'use strict';

// The prompt leak lint and the task file reader, on small fake konductor trees and task directories.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { lintTask, lintDir, nameMatchers } = require('../../scenarios/lint.js');
const { loadTaskFiles } = require('../../scenarios/files.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const CATALOG = { skills: ['threat-modeling', 'verification', 'code-review'], sops: ['k-plan'], agents: ['k-architect'] };
const matchers = nameMatchers(CATALOG);
const rules = (task) => lintTask({ id: 't', ...task }, matchers).map((f) => f.rule);

const ORIGINAL = { family: 'f', model: 'm', source: 'original', date: '2026-11-19' };
const PUBLIC = (o = {}) => ({ ...ORIGINAL, source: { url: 'https://example.invalid/x', licence: 'MIT', licenceCheckedAt: '2026-11-19', use: 'idea', ...o } });

test('a clean prompt passes, and plain deliverable names are allowed', () => {
  assert.deepEqual(rules({ prompt: 'Write an ADR, a postmortem and a runbook for the payment outage. Do a code review of the diff.' }), []);
});

test('a prompt that names a skill, SOP or agent is refused', () => {
  assert.deepEqual(rules({ prompt: 'Do a threat-modeling pass on the API.' }), ['names-unit']);
  assert.deepEqual(rules({ prompt: 'Follow the k-plan SOP.' }), ['names-unit']);
  assert.deepEqual(rules({ prompt: 'Ask k-architect to draw it.' }), ['names-unit']);
  assert.deepEqual(rules({ prompt: 'Use the skill:code-review skill.' }), ['names-unit']);
  assert.deepEqual(rules({ prompt: 'Save what you learn.', freshSessions: [{ prompt: 'Follow the k-plan SOP.' }] }), ['names-unit'], 'a later session prompt is read too');
});

test('a one-word name counts only in code style or next to skill, SOP or agent', () => {
  assert.deepEqual(rules({ prompt: 'Run the verification of the release by hand.' }), []);
  assert.deepEqual(rules({ prompt: 'Load `verification` first.' }), ['names-unit']);
  assert.deepEqual(rules({ prompt: 'Use the verification skill.' }), ['names-unit']);
  assert.deepEqual(rules({ prompt: 'Use the skill called verification.' }), ['names-unit']);
});

test('a longer name does not trigger a shorter one: k-plan-review is not k-plan', () => {
  assert.deepEqual(rules({ prompt: 'Look at the k-plan-review notes.' }), []);
});

test('method terms are refused; acronyms need capitals, phrases ignore case', () => {
  assert.deepEqual(rules({ prompt: 'Rank the items with RICE.' }), ['method-term']);
  assert.deepEqual(rules({ prompt: 'Boil the rice for the cafeteria menu.' }), []);
  assert.deepEqual(rules({ prompt: 'Use STRIDE on each component.' }), ['method-term']);
  assert.deepEqual(rules({ prompt: 'Write the criteria as Given/When/Then.' }), ['method-term']);
  assert.deepEqual(rules({ prompt: 'Try the Five Whys on the outage.' }), ['method-term']);
  assert.deepEqual(rules({ prompt: 'Sort them moscow style: MOSCOW.' }), ['method-term']);
});

test('"do not ask" is refused when questions are allowed (the default) and accepted when forbidden or scripted', () => {
  assert.deepEqual(rules({ prompt: 'Build it. Do not ask me questions.' }), ['no-ask']);
  assert.deepEqual(rules({ prompt: "Don't ask, just do it.", questions: 'allowed' }), ['no-ask']);
  assert.deepEqual(rules({ prompt: 'Do it without asking.' }), ['no-ask']);
  assert.deepEqual(rules({ prompt: 'Build it. Do not ask me questions.', questions: 'forbidden' }), []);
  assert.deepEqual(rules({ prompt: 'Do not ask me questions.', questions: 'scripted' }), []);
});

test('a v3 task needs authorship.source; an old task without a phase is exempt', () => {
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix' }), ['authorship']);
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: { family: 'f', model: 'm', date: '2026-11-19' } }), ['authorship']);
  assert.deepEqual(rules({ prompt: 'ok' }), []);
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: ORIGINAL }), []);
});

test('a public source needs a licence and the other source fields', () => {
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: PUBLIC() }), []);
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: PUBLIC({ licence: '' }) }), ['authorship']);
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: PUBLIC({ licence: '   ' }) }), ['authorship']);
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: PUBLIC({ url: undefined }) }), ['authorship']);
  assert.deepEqual(rules({ prompt: 'ok', phase: 'bugfix', authorship: { ...ORIGINAL, source: 'somewhere' } }), ['authorship']);
  const f = lintTask({ id: 't', prompt: 'ok', phase: 'bugfix', authorship: PUBLIC({ licence: '' }) }, matchers);
  assert.match(f[0].detail, /licence is empty/);
});

function packDir() {
  const dir = tmp();
  write(path.join(dir, 'b1/good.json'), JSON.stringify({ id: 'good', prompt: 'Fix the failing parser test.', phase: 'bugfix', authorship: ORIGINAL }));
  write(path.join(dir, 'b1/leaky.json'), JSON.stringify({ id: 'leaky', prompt: 'Run a threat-modeling session.', phase: 'security', authorship: ORIGINAL }));
  write(path.join(dir, 'b1/fixtures/repo/package.json'), JSON.stringify({ id: 'not-a-task', prompt: 'x' }));
  write(path.join(dir, 'b1/hidden/check.json'), JSON.stringify({ id: 'hidden-thing', prompt: 'x' }));
  write(path.join(dir, 'coverage.json'), JSON.stringify({ id: 'generated', prompt: 'x' }));
  return dir;
}

test('the reader finds tasks in batch directories and skips fixtures, hidden checks and generated files', () => {
  const dir = packDir();
  assert.deepEqual(loadTaskFiles(dir).map((t) => t.task.id), ['good', 'leaky']);
});

test('the reader refuses invalid JSON and a duplicate id instead of skipping them', () => {
  const dir = tmp();
  write(path.join(dir, 'a.json'), '{ not json');
  assert.throws(() => loadTaskFiles(dir), /not valid JSON/);
  const dup = tmp();
  write(path.join(dup, 'a.json'), JSON.stringify({ id: 'x', prompt: 'p' }));
  write(path.join(dup, 'sub/b.json'), JSON.stringify({ id: 'x', prompt: 'p' }));
  assert.throws(() => loadTaskFiles(dup), /two files/);
});

test('lintDir reports the leaky task with its file', () => {
  const res = lintDir(packDir(), CATALOG);
  assert.equal(res.tasks, 2);
  assert.deepEqual(res.findings.map((f) => [f.taskId, f.rule]), [['leaky', 'names-unit']]);
  assert.match(res.findings[0].file, /leaky\.json$/);
});

function konductorTree() {
  const tree = tmp();
  write(path.join(tree, 'skills/threat-modeling/SKILL.md'), '---\nname: threat-modeling\ndescription: Use when modeling threats.\n---\n\n# T\n');
  write(path.join(tree, 'agent-sops/k-plan.sop.md'), '# Plan\n\n## Overview\n\nPlans work.\n');
  write(path.join(tree, 'agents/k-architect.agent-spec.json'), JSON.stringify({ name: 'k-architect', config: { description: 'Architect.' } }));
  return tree;
}

test('the CLI exits 1 with the findings, 0 when clean, and 2 without --base or a directory', () => {
  const tree = konductorTree();
  const dir = packDir();
  const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: tmp() } });
  const bad = cli(['scenarios', 'lint', dir, '--base', `dir:${tree}`]);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout, /leaky: names-unit: names the skill "threat-modeling"/);
  assert.match(bad.stdout, /2 task\(s\) checked .*1 finding\(s\)/);
  fs.rmSync(path.join(dir, 'b1/leaky.json'));
  const ok = cli(['scenarios', 'lint', dir, '--base', `dir:${tree}`, '--json']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).findings, []);
  assert.equal(cli(['scenarios', 'lint', dir]).status, 2);
  assert.equal(cli(['scenarios', 'lint', '--base', `dir:${tree}`]).status, 2);
  assert.equal(cli(['scenarios', 'nope']).status, 2);
});
