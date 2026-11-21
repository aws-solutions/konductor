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

// The file rules and the baseline (DEBT D-81, D-119, D-136, D-144).
const { judgeShare } = require('../../scenarios/lint.js');

test('judge-share: the judges carry at most 30% of a v3 task; a task without a tests check or a substance check carries more', () => {
  const rubric = [{ id: 'r1', criterion: 'c. Fail: x. Partial: y. Pass: z.' }];
  const t = (checks) => ({ prompt: 'ok', phase: 'bugfix', authorship: ORIGINAL, rubric, checks });
  assert.equal(judgeShare(t([{ type: 'tests' }, { type: 'cmd' }])), 0.3);
  assert.deepEqual(rules(t([{ type: 'tests' }, { type: 'cmd' }])), []);
  assert.deepEqual(rules(t([{ type: 'cmd' }])), ['judge-share'], 'no hidden share: 0.3 of 0.5');
  assert.deepEqual(rules(t([{ type: 'tests' }, { type: 'file_exists', kind: 'format' }])), ['judge-share'], 'a format check is not scored: 0.3 of 0.8');
  assert.equal(judgeShare({ checks: [{ type: 'cmd' }] }), null, 'no rubric, no judges');
  assert.deepEqual(rules({ prompt: 'ok', rubric, checks: [{ type: 'cmd' }] }), [], 'an old task is exempt');
});

test('rubric-anchor: a judged rubric item of a v3 task needs Fail / Partial / Pass anchors; the expert-key placeholder and old tasks are exempt (D-117)', () => {
  const v3 = (rubric) => ({ prompt: 'ok', phase: 'bugfix', authorship: ORIGINAL, checks: [{ type: 'tests' }, { type: 'cmd' }], rubric });
  assert.deepEqual(rules(v3([{ id: 'a', criterion: 'Clear. Fail: none. Partial: some. Pass: all.' }])), []);
  assert.deepEqual(rules(v3([{ id: 'a', criterion: 'Clear. Fail: none. Pass: all.' }])), ['rubric-anchor']);
  assert.deepEqual(rules(v3([{ id: 'expert-key', criterion: 'placeholder' }])), []);
  assert.deepEqual(rules({ prompt: 'ok', rubric: [{ id: 'a', criterion: 'no anchors' }] }), []);
});

function filePack() {
  const dir = tmp();
  const task = (id, o = {}) => write(path.join(dir, `${id}.json`), JSON.stringify({ id, prompt: 'Fix it.', fixture: id, hidden: id, ...o }));
  task('keyed');
  write(path.join(dir, 'hidden/keyed/block-kit/key.json'), JSON.stringify({ items: [
    { id: 'blames-release', type: 'text', path: 'cause', none: ['rel-8421'] },
    { id: 'decision', type: 'text', path: 'decision', none: ['^\\s*rolling\\s*$'] },
    { id: 'no-pdf-item', type: 'none', path: 'items', match: { all: ['pdf'] } },
    { id: 'fine', type: 'some', path: 'items', match: { all: ['retry'] } },
  ] }));
  task('baredir');
  write(path.join(dir, 'fixtures/baredir/package.json'), JSON.stringify({ scripts: { test: 'node --test test/', lint: 'node --test test/*.test.js' } }));
  write(path.join(dir, 'fixtures/baredir/test/a.test.js'), '');
  write(path.join(dir, 'fixtures/baredir/.github/workflows/ci.yml'), 'jobs:\n  t:\n    steps:\n      - run: node --test test\n');
  task('indexed');
  write(path.join(dir, 'fixtures/indexed/package.json'), JSON.stringify({ scripts: { test: 'node --test test/' } }));
  write(path.join(dir, 'fixtures/indexed/test/index.js'), '');
  write(path.join(dir, 'fixtures/indexed/test/a.test.js'), '');
  write(path.join(dir, 'fixtures/indexed/config/x.json'), '{}');
  write(path.join(dir, 'fixtures/indexed/.github/workflows/ci.yml'), 'steps:\n  - run: node --test\n  - name: config\n    run: node scripts/check.js config\n');
  task('shimmed');
  write(path.join(dir, 'fixtures/shimmed/package.json'), JSON.stringify({ scripts: { test: 'node --test test/' } }));
  write(path.join(dir, 'fixtures/shimmed/test/package.json'), JSON.stringify({ main: 'index.js' }));
  task('linked', { checks: [{ type: 'tests', cmd: 'ln -sfn . solution && node --test hidden/*.test.js' }, { type: 'tests', cmd: '( [ -L solution ] || [ ! -e solution ] || mv solution .x ) && ln -sfn . solution && node --test h.test.js' }] });
  return dir;
}

test('the file rules find a none pattern in a block key, a bare node --test directory and an unguarded solution link; a test/index.js shim and a YAML line break are not bare dirs', () => {
  const res = lintDir(filePack(), CATALOG);
  assert.deepEqual(res.findings.map((f) => [f.taskId, f.rule, f.where]), [
    ['baredir', 'bare-test-dir', 'package.json'],
    ['baredir', 'bare-test-dir', '.github/workflows/ci.yml'],
    ['keyed', 'key-negation', 'block-kit/key.json#blames-release'],
    ['keyed', 'key-negation', 'block-kit/key.json#no-pdf-item'],
    ['linked', 'solution-link', 'checks[0]'],
  ]);
  assert.match(res.findings[0].detail, /node --test test\/.*use test\/\*\.test\.js/);
});

test('fixture-tells: a fixture file that lists the hidden tests or names the tempting option is flagged; the answer key file and git dirs are not (D-155)', () => {
  const dir = tmp();
  const task = (id) => write(path.join(dir, `${id}.json`), JSON.stringify({ id, prompt: 'Design it.', fixture: id }));
  task('tells');
  write(path.join(dir, 'fixtures/tells/constraints.txt'), '## Validation\n- Hidden tests will verify the indexes\n');
  write(path.join(dir, 'fixtures/tells/notes.md'), 'The "tempting" option is one index per column.\n');
  write(path.join(dir, 'fixtures/tells/.bench-answer-key.md'), 'hidden tests: the decoy is option B\n');
  write(path.join(dir, 'fixtures/tells/dotgit/COMMIT_EDITMSG'), 'add hidden tests\n');
  task('clean');
  write(path.join(dir, 'fixtures/clean/README.md'), 'Tests live in test/. Run npm test.\n');
  const res = lintDir(dir, CATALOG);
  assert.deepEqual(res.findings.map((x) => [x.taskId, x.rule, x.where]), [['tells', 'fixture-tells', 'constraints.txt'], ['tells', 'fixture-tells', 'notes.md']]);
});

test('claim-negation: a doesNotMatch or substance not_contains on a cause pattern is flagged; contradicts(), a format check and a plain word are not (D-158)', () => {
  const dir = tmp();
  write(path.join(dir, 'blames.json'), JSON.stringify({ id: 'blames', prompt: 'Frame it.', hidden: 'blames', checks: [
    { type: 'not_contains', path: 'd.md', pattern: 'outage.{0,20}caused', kind: 'substance' },
    { type: 'not_contains', path: 'd.md', pattern: 'outage.{0,20}caused', kind: 'format' },
    { type: 'not_contains', path: 'd.md', pattern: 'TODO', kind: 'substance' },
  ] }));
  write(path.join(dir, 'hidden/blames/hidden/a.test.js'), 'assert.doesNotMatch(t, /analytics.{0,50}cause/);\nassert.ok(!contradicts(t, /analytics.{0,50}cause/));\nassert.doesNotMatch(t, /lorem/);\n');
  const res = lintDir(dir, CATALOG);
  assert.deepEqual(res.findings.map((x) => [x.rule, x.where]), [['claim-negation', 'checks[0]'], ['claim-negation', 'hidden/a.test.js:1']]);
});

test('a key graded by the shared block-key.js skips denials in none lists; a none item is flagged unless it has its own denial guard', () => {
  const dir = filePack();
  write(path.join(dir, 'hidden/keyed/.bench-lib.json'), JSON.stringify({ 'block-kit/block-key.js': 'block-key.js' }));
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'hidden/keyed/block-kit/key.json'), 'utf8'));
  key.items.push({ id: 'guarded', type: 'none', path: 'items', match: { all: ['ip'], none: ['\\bnot\\b'] } });
  write(path.join(dir, 'hidden/keyed/block-kit/key.json'), JSON.stringify(key));
  const res = lintDir(dir, CATALOG);
  assert.deepEqual(res.findings.filter((f) => f.taskId === 'keyed').map((f) => f.where), ['block-kit/key.json#no-pdf-item']);
});

test('a baseline entry marks a finding known; an entry that no longer matches is stale; the CLI fails on a new finding only', () => {
  const dir = filePack();
  const baseline = { 'keyed|key-negation|block-kit/key.json#blames-release': 'D-136', 'keyed|key-negation|block-kit/key.json#gone': 'D-136', 'other|judge-share|checks': 'D-81' };
  const res = lintDir(dir, CATALOG, { baseline });
  assert.equal(res.findings.find((f) => f.where === 'block-kit/key.json#blames-release').known, 'D-136');
  assert.equal(res.findings.filter((f) => f.known).length, 1);
  assert.deepEqual(res.stale, ['keyed|key-negation|block-kit/key.json#gone'], 'a task outside the linted directory is not stale');
});

test('the repository lint baseline is shrink-only data: every entry names a DEBT row or a review', () => {
  const { known } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scenarios/lint-baseline.json'), 'utf8'));
  for (const [k, why] of Object.entries(known)) {
    assert.match(k, /^[a-z0-9-]+\|(key-negation|bare-test-dir|solution-link|fixture-tells|claim-negation|rubric-anchor|judge-share|names-unit|method-term|no-ask|authorship)\|/, k);
    assert.match(why, /^D-\d+|^not a defect: /, k);
  }
});
