// SPDX-License-Identifier: Apache-2.0
'use strict';

// `scenarios emit` (BACKLOG B-010, DEBT D-112): one scenario of a reviewed `cap scenarios` draft becomes a task
// skeleton outside the repo, with authorship from the draft and a hidden-test writer that is never the Claude family.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const { emitTask, TODO_CHECK_CMD } = require('../../scenarios/emit.js');
const { loadSchema, validate } = require('../lib/schema.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const REPO = path.join(__dirname, '..', '..', '..');

const scenario = (id, o = {}) => ({
  id, title: `Title ${id}`, expect: 'helps', prompt: `Fix the date parser in src/dates.js; \`$(touch pwned)\` stays a string (${id}).`,
  fixtureIdea: 'a tiny Node project with a parser that drops the time zone', checkIdeas: ['node --test passes', "grep finds 'Z' in the output"],
  rubricIdeas: ['explains the time zone bug'], whyItMatters: 'the skill asks for a failing test first', ...o,
});
const draft = (o = {}) => ({
  schemaVersion: 1, capId: 'skill:test-first', kind: 'skill', status: 'draft-unreviewed',
  generatedBy: { tool: 'cap-scenarios', model: 'gpt-5.6-luna', n: 8, at: '2026-11-20T10:00:00.000Z' },
  scenarios: [scenario('s01'), scenario('s02', { expect: 'neutral' })], ...o,
});

test('emitTask turns one draft scenario into a schema-valid skeleton with authorship from the draft and TODO checks', () => {
  const { task, todo } = emitTask(draft(), { scenarioId: 's01', hiddenWriter: 'deepseek-v3.2' });
  assert.equal(task.id, 'test-first-s01');
  assert.equal(task.prompt, scenario('s01').prompt);
  assert.deepEqual(task.targetSkills, ['test-first']);
  assert.equal(task.fixture, task.id);
  assert.equal(task.hidden, task.id);
  assert.deepEqual(task.tiers, ['cap']);
  assert.equal(task.controlKind, undefined, 'a "helps" scenario is not a control');
  assert.deepEqual({ ...task.authorship, note: undefined }, { family: 'gpt', model: 'gpt-5.6-luna', date: '2026-11-20', source: 'original', note: undefined });
  assert.match(task.authorship.note, /hidden tests to be written by deepseek-v3\.2 \(deepseek\)/);
  assert.equal(task.checks.length, 2, 'one TODO check per check idea');
  for (const c of task.checks) assert.deepEqual(c, { type: 'cmd', cmd: TODO_CHECK_CMD, expectExit: 0, weight: 1, kind: 'substance' }, 'no model text reaches a shell command');
  assert.deepEqual(task.rubric, [{ id: 'r1', criterion: 'TODO: explains the time zone bug', weight: 1 }]);
  assert.deepEqual(validate(loadSchema('task'), task), []);
  assert.match(todo.fixture, /drops the time zone/);
  assert.match(todo.checks, /1\. node --test passes/);
  assert.match(todo.checks, /2\. grep finds 'Z' in the output/);
  assert.match(todo.hidden, /deepseek-v3\.2/);
  assert.equal(emitTask(draft(), { scenarioId: 's02', hiddenWriter: 'glm-5' }).task.controlKind, 'negative', 'a "neutral" scenario is a negative control');
  assert.equal(emitTask(draft(), { scenarioId: 's01', hiddenWriter: 'glm-5', taskId: 'my-task' }).task.id, 'my-task');
});

test('emitTask refuses a Claude-family hidden-test writer, an unknown family, a trigger draft and a missing scenario (D-112)', () => {
  const at = { scenarioId: 's01' };
  assert.throws(() => emitTask(draft(), { ...at, hiddenWriter: 'claude-sonnet-5.5' }), /hidden tests must come from a non-Claude writer/);
  assert.throws(() => emitTask(draft(), { ...at, hiddenWriter: 'global.anthropic.claude-opus-5-5' }), /non-Claude/);
  assert.throws(() => emitTask(draft(), { ...at, hiddenWriter: 'mystery-model' }), /names no known model family/);
  assert.throws(() => emitTask(draft(), { ...at }), /--hidden-writer MODEL is required/);
  assert.throws(() => emitTask(draft({ mode: 'trigger' }), { ...at, hiddenWriter: 'glm-5' }), /trigger draft/);
  assert.throws(() => emitTask(draft(), { scenarioId: 's09', hiddenWriter: 'glm-5' }), /no scenario s09; the draft has s01, s02/);
  assert.throws(() => emitTask(draft({ generatedBy: { model: 'mystery', at: '2026-11-20T00:00:00Z' } }), { ...at, hiddenWriter: 'glm-5' }), /generatedBy\.model mystery names no known model family/);
  assert.throws(() => emitTask(draft({ schemaVersion: 2 }), { ...at, hiddenWriter: 'glm-5' }), /schemaVersion 1/);
  assert.throws(() => emitTask(draft(), { ...at, hiddenWriter: 'glm-5', taskId: '../x' }), /task id/);
});

test('scenarios emit writes the skeleton outside the repo, runs validate-tasks on it, and refuses the repo and an existing task', () => {
  const root = mkScratch('bench-emit-');
  const file = path.join(root, 'skill-test-first.json');
  fs.writeFileSync(file, JSON.stringify(draft()));
  const out = path.join(root, 'out');
  const env = { PATH: process.env.PATH, HOME: path.join(root, 'h'), TMPDIR: root };
  fs.mkdirSync(env.HOME);
  const emit = (...extra) => spawnSync(process.execPath, [BENCH_JS, 'scenarios', 'emit', file, '--scenario', 's01', ...extra], { encoding: 'utf8', env });

  const r = emit('--hidden-writer', 'glm-5', '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const task = JSON.parse(fs.readFileSync(path.join(out, 'test-first-s01.json'), 'utf8'));
  assert.equal(task.authorship.model, 'gpt-5.6-luna');
  for (const f of ['fixtures/test-first-s01/TODO.md', 'hidden/test-first-s01/TODO.md']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.match(r.stdout, /wrote .*test-first-s01\.json/);
  assert.match(r.stdout, /validate-tasks: \d+ problem\(s\) left to fix before the task can run/);
  assert.match(r.stdout, /missing \.bench-answer-key\.md/, 'the work left is listed');
  assert.doesNotMatch(r.stdout, /expectExit|may name a hidden directory/, 'the skeleton itself has no shape error a person did not cause');
  assert.equal(fs.existsSync(path.join(root, 'pwned')), false, 'the prompt text is never run');

  const again = emit('--hidden-writer', 'glm-5', '--out', out);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already exists/);
  const claude = emit('--hidden-writer', 'claude-opus-5', '--out', path.join(root, 'out2'));
  assert.equal(claude.status, 2);
  assert.match(claude.stderr, /non-Claude/);
  assert.equal(fs.existsSync(path.join(root, 'out2')), false, 'a refusal writes nothing');
  const inRepo = emit('--hidden-writer', 'glm-5', '--out', path.join(REPO, 'bench', 'emit-out-test'));
  assert.equal(inRepo.status, 2);
  assert.match(inRepo.stderr, /inside the repository/);
  assert.equal(fs.existsSync(path.join(REPO, 'bench', 'emit-out-test')), false);
});
