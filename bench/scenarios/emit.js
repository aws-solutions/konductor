// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios emit DRAFT --scenario ID --hidden-writer MODEL --out DIR`: one scenario of a reviewed
// `cap scenarios` lift draft becomes a task skeleton in a directory outside the repository (BACKLOG B-010, DEBT D-112).
// The skeleton holds the prompt, the target skill and `authorship` from the draft's generatedBy; its checks and rubric
// are TODO placeholders a person replaces, and TODO.md files carry the fixture and check ideas. validate-tasks then runs
// on the directory and its problems are the list of what is left. Free: no model call, no credits.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { familyOf } = require('../judge/family.js');
const { checkScratch } = require('../cap/variant.js');
const { textFlag, repoRootOf } = require('../runner/lib/flag-values.js');

const VALIDATE = path.join(__dirname, '..', 'tasks', 'validate-tasks.js');
const ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
// A fixed command, so no draft text (model output) ever reaches a shell. It fails until a person writes the check.
const TODO_CHECK_CMD = "echo 'TODO: write this check (see fixtures/<id>/TODO.md)' >&2; exit 1";

/**
 * The model that will write the hidden tests, checked against the owner rule: never the Claude family, and the family
 * must be known so the rule can be checked at all. Returns its family.
 */
function hiddenWriterFamily(model) {
  if (!model) throw new Error('--hidden-writer MODEL is required: the model that will write the hidden tests');
  const family = familyOf(model);
  if (!family) throw new Error(`--hidden-writer ${model} names no known model family, so the non-Claude rule cannot be checked`);
  if (family === 'claude') throw new Error(`--hidden-writer ${model} is the Claude family: hidden tests must come from a non-Claude writer (owner rule, DEBT D-112)`);
  return family;
}

/**
 * The task skeleton for one scenario of a `cap scenarios` lift draft.
 * @param {object} draft the parsed draft file (schemaVersion 1, from `cap scenarios`)
 * @param {object} o
 * @param {string} o.scenarioId the scenario to emit (s01, s02, ...)
 * @param {string} o.hiddenWriter model id of the hidden-test writer; refused when Claude or of unknown family
 * @param {string} [o.taskId] the task id; default `<skill>-<scenarioId>`
 * @returns {{ task: object, todo: { fixture: string, checks: string, hidden: string } }} the task and the TODO.md texts
 */
function emitTask(draft, { scenarioId, hiddenWriter, taskId } = {}) {
  if (draft?.schemaVersion !== 1) throw new Error('the draft must be a `cap scenarios` file with schemaVersion 1');
  if (draft.mode === 'trigger') throw new Error('this is a trigger draft: its scenarios become trigger checks, not lift tasks');
  const writerFamily = hiddenWriterFamily(hiddenWriter);
  const ideaModel = draft.generatedBy?.model;
  const ideaFamily = familyOf(ideaModel ?? '');
  if (!ideaFamily) throw new Error(`the draft's generatedBy.model ${ideaModel} names no known model family, so authorship cannot be written`);
  const date = String(draft.generatedBy?.at ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('the draft has no generatedBy.at date');
  const scenarios = Array.isArray(draft.scenarios) ? draft.scenarios : [];
  const s = scenarios.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`no scenario ${scenarioId}; the draft has ${scenarios.map((x) => x.id).join(', ') || 'none'}`);
  const skill = String(draft.capId ?? '').replace(/^skill:/, '');
  const id = taskId ?? `${skill}-${s.id}`;
  if (!ID_PATTERN.test(id)) throw new Error(`task id ${id} must match ${ID_PATTERN}`);

  const task = {
    id, class: 'hard', version: 1, prompt: s.prompt, fixture: id, hidden: id, timeoutSec: 600,
    checks: s.checkIdeas.map(() => ({ type: 'cmd', cmd: TODO_CHECK_CMD, expectExit: 0, weight: 1, kind: 'substance' })),
    rubric: (s.rubricIdeas ?? []).map((idea, i) => ({ id: `r${i + 1}`, criterion: `TODO: ${idea}`, weight: 1 })),
    tiers: ['cap'], targetSkills: [skill],
    ...(s.expect === 'neutral' ? { controlKind: 'negative' } : {}),
    authorship: {
      family: ideaFamily, model: ideaModel, date, source: 'original',
      // shortcut: the task schema has no field for the hidden-test writer, so it rides in the note; add one if a check must read it.
      note: `emitted from cap scenarios draft ${draft.capId} ${s.id}; hidden tests to be written by ${hiddenWriter} (${writerFamily})`,
    },
  };
  const todo = {
    fixture: `# Fixture for ${id}\n\nTODO: build this fixture, then add .bench-answer-key.md.\n\n${s.fixtureIdea}\n`,
    checks: s.checkIdeas.map((c, i) => `${i + 1}. ${c}`).join('\n'),
    hidden: `# Hidden tests for ${id}\n\nTODO: written by ${hiddenWriter} (${writerFamily}), never a Claude-family model.\n`,
  };
  todo.fixture += `\nChecks to write (one per TODO check in the task):\n\n${todo.checks}\n`;
  return { task, todo };
}

/** Counts the `error:` lines of a validate-tasks run on `dir`; null when it did not run to a verdict. */
function validateProblems(dir) {
  const r = spawnSync(process.execPath, [VALIDATE, '--only-extra', '--extra-tasks', dir], { encoding: 'utf8' });
  if (r.status === 0) return { count: 0, lines: [] };
  if (r.status !== 1) return null;
  const lines = r.stderr.split('\n').filter((l) => l.startsWith('error: '));
  return { count: lines.length, lines };
}

function cmdEmit(opts) {
  const file = opts._[1];
  if (!file) throw new Error('scenarios emit needs the draft file: bench.js scenarios emit DRAFT --scenario ID --hidden-writer MODEL --out DIR');
  const out = textFlag(opts.out);
  if (!out) throw new Error('--out DIR is required: a directory outside the repository');
  let draft;
  try { draft = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read the draft ${file}: ${e.message}`); }
  const { task, todo } = emitTask(draft, { scenarioId: textFlag(opts.scenario), hiddenWriter: textFlag(opts['hidden-writer']), taskId: textFlag(opts['task-id']) });
  const dir = checkScratch(out, repoRootOf(opts), '--out');
  const taskFile = path.join(dir, `${task.id}.json`);
  if (fs.existsSync(taskFile)) throw new Error(`${taskFile} already exists; pick another --out or --task-id`);
  for (const [sub, text] of [['fixtures', todo.fixture], ['hidden', todo.hidden]]) {
    fs.mkdirSync(path.join(dir, sub, task.id), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, task.id, 'TODO.md'), text);
  }
  fs.writeFileSync(taskFile, `${JSON.stringify(task, null, 2)}\n`);
  console.log(`wrote ${taskFile}, fixtures/${task.id}/TODO.md and hidden/${task.id}/TODO.md`);
  const v = validateProblems(dir);
  if (!v) { console.error('validate-tasks did not finish; run it yourself: node bench/tasks/validate-tasks.js --only-extra --extra-tasks DIR'); process.exitCode = 1; return; }
  console.log(`validate-tasks: ${v.count} problem(s) left to fix before the task can run`);
  for (const l of v.lines) console.log(`  ${l.slice('error: '.length)}`);
}

module.exports = { emitTask, cmdEmit, hiddenWriterFamily, TODO_CHECK_CMD };
