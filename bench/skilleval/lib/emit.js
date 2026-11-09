// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./util.js');
const { isFrozen, verify } = require('./freeze.js');
const { PROMPT_BANNED } = require('./scenarios.js');

const BENCH = path.resolve(__dirname, '..', '..');
const FIXTURE = 'skilleval-empty';
const TIMEOUT_SEC = 300;
// Every bench prompt ends with this sentence (bench/tasks/validate-tasks.js).
const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
const ANSWER_IN_REPLY = 'Give your whole answer in your reply; do not create or change any files.';
const JUDGES = ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'];
const TYPE_LABEL = { rule: 'rule', blind: 'blind', 'near-miss': 'nearmiss' };

const taskId = (skill, scenario) => `se-${skill}-${scenario.id}`;
const suiteName = (skill) => `skilleval-${skill}`;

function taskOf(skill, scenario, rubric) {
  return {
    id: taskId(skill, scenario),
    class: 'simple',
    target: null,
    prompt: `${scenario.prompt}\n\n${ANSWER_IN_REPLY} ${NO_QUESTIONS}`,
    fixture: FIXTURE,
    timeoutSec: TIMEOUT_SEC,
    checks: [],
    rubric: rubric.rubric,
    tiers: ['cap'],
  };
}

/** Problems that would make the runner or the task validator refuse an emitted task (empty when it is fine). */
function checkTask(task) {
  const problems = [];
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(task.id)) problems.push('bad id');
  if (task.class !== 'simple' || task.target !== null || task.timeoutSec !== TIMEOUT_SEC) problems.push('fixed fields differ');
  if (!task.prompt.endsWith(NO_QUESTIONS)) problems.push('prompt does not end with the no-questions sentence');
  if (PROMPT_BANNED.test(task.prompt)) problems.push('prompt names a konductor procedure');
  if (task.checks.length) problems.push('text-only tasks carry no checks');
  if (task.rubric.length < 4 || task.rubric.length > 6) problems.push('rubric needs 4 to 6 items');
  if (new Set(task.rubric.map((r) => r.id)).size !== task.rubric.length) problems.push('duplicate rubric ids');
  for (const r of task.rubric) if (!r.id || !r.criterion || !(r.weight >= 0)) problems.push(`bad rubric item ${r.id}`);
  return problems;
}

/**
 * Writes one task per scenario that has a rubric, the suite file bench/suites/skilleval-SKILL.json, the oracle manifest and the
 * expectations. Scenarios without a rubric are skipped and reported. A frozen skill must still match its freeze.
 */
function emit({ skill, dir, benchDir = BENCH }) {
  if (isFrozen(dir)) {
    const v = verify(dir);
    if (!v.ok) throw new Error(`emit refused: the frozen inputs changed (${v.problems.join('; ')})`);
  }
  const scenarios = readJson(path.join(dir, 'scenarios.json')).scenarios;
  const rubrics = new Map(readJson(path.join(dir, 'rubric.json')).rubrics.map((r) => [r.scenarioId, r]));
  const tasksDir = path.join(dir, 'tasks');
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, '.skilleval'), 'Tasks emitted by bench/skilleval/skilleval.js. Text-only; scored by rubric.\n');
  fs.mkdirSync(path.join(tasksDir, 'fixtures', FIXTURE), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 'fixtures', FIXTURE, 'README.md'), 'Empty workspace. The task is answered in the reply.\n');
  const emitted = [];
  const skipped = [];
  for (const s of scenarios) {
    const r = rubrics.get(s.id);
    if (!r) { skipped.push({ id: s.id, reason: 'no rubric' }); continue; }
    const task = taskOf(skill, s, r);
    const problems = checkTask(task);
    if (problems.length) { skipped.push({ id: s.id, reason: problems.join('; ') }); continue; }
    writeJson(path.join(tasksDir, `${task.id}.json`), task);
    emitted.push({ task, scenario: s });
  }
  const ids = emitted.map((e) => e.task.id);
  const rel = path.relative(benchDir, tasksDir).split(path.sep).join('/');
  const suiteFile = path.join(benchDir, 'suites', `${suiteName(skill)}.json`);
  writeJson(suiteFile, { extraTasks: [rel], tasks: ids, arms: ['vanilla', 'main'], replicates: 1, judges: JUDGES, parallel: 1 });
  writeJson(path.join(dir, 'oracle-manifest.json'), {
    schemaVersion: 1,
    suite: suiteName(skill),
    purpose: 'Oracle arm: put the skill body in front of every prompt. For near-miss tasks this measures the cost of applying the skill where it should not apply.',
    tasks: emitted.map((e) => ({ id: e.task.id, entries: [{ expectedSkills: [skill] }] })),
  });
  writeJson(path.join(dir, 'expectations.json'), {
    skill,
    suite: suiteName(skill),
    natural: Object.fromEntries(emitted.map((e) => [e.task.id, {
      type: TYPE_LABEL[e.scenario.type],
      skill: e.scenario.type === 'near-miss' ? 'not loaded' : 'loaded',
      ruleIds: e.scenario.ruleIds,
    }])),
  });
  return { emitted: ids, skipped, suiteFile, tasksDir };
}

module.exports = { emit, taskOf, checkTask, taskId, suiteName, NO_QUESTIONS, FIXTURE, TIMEOUT_SEC };
