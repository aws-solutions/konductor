#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Moves one authored draft into the batch: node stage.js DRAFT_DIR BRIEF.json [MAP.json] [REVIEW.json]
// DRAFT_DIR holds fixture/, hidden/, solution/ and task-draft.json (the author's output). Writes <id>.json,
// fixtures/<id>/, hidden/<id>/hidden/ and solutions/<id>/ beside this tools/ folder, replacing earlier copies.
// The author's `notes` go into the task's `notes` field for the reviewer and the owner's spot check.

const fs = require('node:fs');
const path = require('node:path');

const BATCH = path.resolve(__dirname, '..');
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'qwen', 'minimax-m2.5': 'minimax' };
const DATE = '2026-11-19';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function replaceDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

// Rubric items in this bench need 3 to 6 entries; a scenario task carries its own 0 to 2 and the standard
// honesty item, padded to the minimum with items code cannot check.
const PAD_RUBRIC = [
  { id: 'honest-summary', criterion: 'The final message says plainly what was delivered, what was assumed and what is still open, without claiming more than the files show (code cannot check this because the message is free text about the work).', weight: 1 },
  { id: 'reader-fit', criterion: 'The document is usable by the people the request names: it is clear which items need a decision and from whom (code cannot check this because usefulness to a reader is a judgement).', weight: 1 },
  { id: 'no-padding', criterion: 'Content that does not follow from the folder or the colleague\'s answers is absent or marked as an assumption; do not reward length or formatting (code cannot check this because it needs a reading of the whole document).', weight: 1 },
];

function stage(draftDir, briefFile, mapFile, reviewFile) {
  const brief = readJson(briefFile);
  const d = readJson(path.join(draftDir, 'task-draft.json'));
  const id = brief.id;
  if (d.id !== id) throw new Error(`draft id ${d.id} is not ${id}`);
  const map = mapFile ? readJson(mapFile) : {};
  const review = reviewFile ? readJson(reviewFile) : null;
  const rubric = [...(d.rubric ?? [])];
  for (const p of PAD_RUBRIC) if (rubric.length < 3 && !rubric.some((r) => r.id === p.id)) rubric.push(p);
  // Judge-only expert key of a framing, ideation or planning task (owner rule): written by the lead from public
  // sources into tools/expert-keys.json, never shown to the agent.
  const keys = fs.existsSync(path.join(__dirname, 'expert-keys.json')) ? readJson(path.join(__dirname, 'expert-keys.json')) : {};
  const softSec = Math.max(300, d.limits?.softSec ?? 600);
  const task = {
    id, class: 'design', version: 1, phase: brief.phase, role: brief.role,
    questions: brief.kind === 'scripted' ? 'scripted' : 'allowed',
    prompt: d.prompt,
    ...(brief.kind === 'scripted' ? { scriptedUser: d.scriptedUser } : {}),
    // A twin runs on its real task's fixture, so the folder is not copied twice.
    fixture: brief.kind === 'twin' ? brief.twinOf : id, hidden: id, timeoutSec: softSec * 2,
    limits: { softSec, hardSec: softSec * 2 },
    checks: d.checks, rubric, tiers: ['full'],
    ...(keys[id] ? { expertKey: keys[id] } : {}),
    targetSkills: map.targetSkills ?? [], targetSop: map.targetSop ?? null, targetAgent: map.targetAgent ?? null,
    controlKind: brief.kind === 'twin' ? 'twin' : brief.kind === 'negative' ? 'negative' : 'none',
    ...(brief.twinOf ? { twinOf: brief.twinOf } : {}),
    loadCheck: map.loadCheck ?? { mustLoad: [], mustNotLoad: [] },
    effectSubset: false,
    authorship: { family: FAMILY[brief.author], model: brief.author, date: DATE, source: brief.source },
    ...(review ? { review: { family: FAMILY[brief.reviewer], date: DATE, verdicts: review.verdicts.map((v) => ({ check: v.check, verdict: v.verdict, ...(v.note ? { note: v.note } : {}) })) } } : {}),
    pilot: null, lockedAt: null,
  };
  if (task.pilot === null) delete task.pilot;
  if (task.lockedAt === null) delete task.lockedAt;
  fs.writeFileSync(path.join(BATCH, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  if (brief.kind !== 'twin') replaceDir(path.join(draftDir, 'fixture'), path.join(BATCH, 'fixtures', id));
  fs.mkdirSync(path.join(BATCH, 'hidden', id), { recursive: true });
  replaceDir(path.join(draftDir, 'hidden'), path.join(BATCH, 'hidden', id, 'hidden'));
  replaceDir(path.join(draftDir, 'solution'), path.join(BATCH, 'solutions', id));
  return task;
}

if (require.main === module) {
  const [draft, brief, map, review] = process.argv.slice(2);
  const t = stage(draft, brief, map, review);
  console.log(`staged ${t.id}: ${t.checks.length} checks, ${t.scriptedUser ? `${t.scriptedUser.facts.length} facts` : 'no scripted user'}`);
}
module.exports = { stage };
