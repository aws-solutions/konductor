// SPDX-License-Identifier: Apache-2.0
'use strict';

// T13's batch config: the three types of work the pack had no task for (documentation, triage, log analysis), six
// document tasks written from reports/new-task-briefs-2026-11-24/ (the workspace) through T8's doc pipeline: T8's
// author prompts with T13's own `prompts/kind-doc.md` (document-shaped key examples and the key audit rules, D-255) and
// intro line, the same block-kit key and stage steps. Two more things are T13's own:
//   - every task has a scripted user (`questions: scripted`): 3 facts the folder does not hold, listed in the brief
//     (`scriptedUser`), that the agent must ask for; prompts/scripted.md tells the author how to wire them, and
//     taskErrors checks the reference asks unlock every fact and the request repeats none;
//   - the T8 prompt files are read from T8's directory, so the two batches cannot drift apart (a prompt that exists
//     here wins, which is how prompts/scripted.md joins).
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t13/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t13/scenario.config.js audit|log-author|normalize|map|review|variants|assemble <id>
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t13/scenario.config.js [id ...]

const fs = require('node:fs');
const path = require('node:path');
const t8 = require('../t8/scenario.config.js');
const { partDir } = require('../lib/config.js');
const { converse, unmatchedFacts } = require('../t6/tools/fake-user.js');
const { readJson } = require('../../runner/lib/util.js');

const DIR = __dirname;
const T8_DIR = t8.dir;
const GENERIC_ASK = 'Is there anything else I should know before I start?';
const DEFAULT_REPLY = "I'm not sure, use your judgement.";
const T8_INTRO_WORK = 'operations and reliability work';
const T13_INTRO_WORK = 'documentation, triage and log-analysis work';

/** T8's prompt renderer with T13's files first: `prompts/X` is read here when it exists, else from T8. */
function render(id, lib, step = null) {
  const read = (rel) => {
    const own = path.join(DIR, rel);
    return fs.readFileSync(fs.existsSync(own) ? own : path.join(T8_DIR, rel), 'utf8');
  };
  const b = lib.brief(id);
  // T8's intro names ops work; T13's own kind-doc.md replaces T8's incident-shaped key examples (D-255).
  const base = t8.prompt.render(id, { ...lib, read }, step).replaceAll(T8_INTRO_WORK, T13_INTRO_WORK);
  if (b.questions !== 'scripted') return base;
  const facts = (b.scriptedUser?.facts || []).map((f) => `   - ${f.id}: topics ${JSON.stringify(f.topics)}; answer: ${f.answer}`).join('\n');
  return base.replace('## Task file', `${lib.fill(read('prompts/scripted.md'), { FACTS: facts, DEFAULTREPLY: DEFAULT_REPLY })}\n\n## Task file`);
}

const asksOf = (dir) => (dir && fs.existsSync(path.join(dir, 'ASKS.json')) ? readJson(path.join(dir, 'ASKS.json')) : []);

/** The scripted user's record for one scored answer: the reference's asks, an answer's own, none for the stub. */
function conversation(task, mode) {
  if (!task.scriptedUser) return null;
  if (mode === 'stub') return { questions: [] };
  const dir = mode === 'reference' ? partDir(DIR, 'solutions', task.id) : partDir(DIR, 'answers', task.id, mode);
  return converse(task, asksOf(dir));
}

/** Batch rules beyond the loader: a scripted task's asks unlock every fact, a generic ask none, and the request repeats none. */
function taskErrors(task) {
  const errors = [];
  if (task.questions === 'scripted' && !task.scriptedUser) errors.push('a scripted task needs scriptedUser');
  if (!task.scriptedUser) return errors;
  const asks = asksOf(partDir(DIR, 'solutions', task.id));
  if (!asks.length) errors.push('scripted task needs solutions/<id>/ASKS.json with the reference asks');
  const missing = unmatchedFacts(task, converse(task, asks));
  if (missing.length) errors.push(`reference asks do not unlock: ${missing.join(', ')}`);
  const generic = converse(task, [GENERIC_ASK]).questions[0];
  if (generic && generic.matched.length) errors.push(`a generic ask unlocks ${generic.matched.join(', ')}; topics are too broad`);
  const leaked = task.scriptedUser.facts.filter((f) => new RegExp(`\\b${f.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}`, 'i').test(task.prompt));
  if (leaked.length) errors.push(`prompt repeats a fact answer: ${leaked.map((f) => f.id).join(', ')}`);
  return errors;
}

/** Owner rule: a task named in a row of this batch's HAND-EDITS.md (the kept table) carries `handEdited`. */
function handEditedIds() {
  const file = path.join(DIR, 'HAND-EDITS.md');
  if (!fs.existsSync(file)) return new Set();
  const kept = fs.readFileSync(file, 'utf8').split('## Dropped')[0];
  return new Set([...kept.matchAll(/^\| (t13-[a-z0-9-]+(?:, t13-[a-z0-9-]+)*) \|/gm)].flatMap((m) => m[1].split(', ')));
}

/** T8's task builder plus the scripted user from the draft (the brief's facts, as the author copied them), and this batch's hand-edit record. */
function buildTask(s, id) {
  const { handEdited: _t8, ...task } = t8.stage.buildTask(s, id);
  if (handEditedIds().has(id)) task.handEdited = { family: 'claude', editor: 'kirocrew-mate-worker (T13 worker session)', log: 'HAND-EDITS.md' };
  const b = s.brief(id);
  if (b.questions !== 'scripted') return task;
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const scriptedUser = draft.scriptedUser || { facts: b.scriptedUser.facts, defaultReply: DEFAULT_REPLY };
  return { ...task, questions: 'scripted', scriptedUser };
}

module.exports = {
  ...t8,
  dir: DIR,
  conversation,
  taskErrors,
  prompt: { render },
  stage: { ...t8.stage, authEnv: 'T13_AUTH', buildTask },
  GENERIC_ASK,
  DEFAULT_REPLY,
};
