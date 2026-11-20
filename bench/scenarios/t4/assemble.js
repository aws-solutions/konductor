#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Turns one author's output (<work>/fixture, hidden, solution, task-draft.json) plus briefs/<id>.json and an optional
// <work>/../<id>.meta.json (mapping and review results) into the schema v3 task under this directory:
// <id>.json, fixtures/<id>/, hidden/<id>/hidden/, solutions/<id>/. Re-running replaces those paths. Copies of the
// shared hidden helpers (bench/scenarios/lib/hidden) are folded into hidden/<id>/.bench-lib.json.
// The meta file lives in edits/<id>.json (committed, so every post-review change is on record).
// Usage: node assemble.js <id> <work-dir>

const fs = require('node:fs');
const path = require('node:path');

const { foldHelpers } = require('../lib/stage.js');

const DIR = __dirname;

function replaceDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

function assemble(id, work) {
  const brief = JSON.parse(fs.readFileSync(path.join(DIR, 'briefs', `${id}.json`), 'utf8'));
  const draft = JSON.parse(fs.readFileSync(path.join(work, 'task-draft.json'), 'utf8'));
  const metaFile = path.join(DIR, 'edits', `${id}.json`);
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  if (draft.id !== id) throw new Error(`draft id ${draft.id} is not ${id}`);
  const fixtureName = brief.twinOf || id;
  if (!brief.twinOf) replaceDir(path.join(work, 'fixture'), path.join(DIR, 'fixtures', id));
  replaceDir(path.join(work, 'hidden'), path.join(DIR, 'hidden', id, 'hidden'));
  // The author's seeded helper copies become .bench-lib.json entries (the tests check copies them back in).
  foldHelpers(path.join(DIR, 'hidden', id));
  replaceDir(path.join(work, 'solution'), path.join(DIR, 'solutions', id));
  // meta may override the draft after review: prompt, checks, rubric, limits (each change is noted in meta.edits).
  for (const k of ['prompt', 'checks', 'rubric', 'limits']) if (meta[k] !== undefined) draft[k] = meta[k];
  const limits = { softSec: Math.round(draft.limits.softSec), hardSec: Math.round(draft.limits.hardSec) };
  const task = {
    id,
    version: 1,
    class: brief.kind === 'findings' ? 'review' : 'complex',
    phase: brief.phase,
    phases2: meta.phases2 || [],
    role: brief.role,
    questions: 'allowed',
    prompt: draft.prompt,
    fixture: fixtureName,
    hidden: id,
    timeoutSec: limits.hardSec,
    limits,
    checks: draft.checks,
    ...(meta.findingsKey ? { findingsKey: meta.findingsKey } : {}),
    rubric: draft.rubric || [],
    ...(meta.expertKey ? { expertKey: meta.expertKey } : {}),
    tiers: ['full'],
    targetSkills: meta.targetSkills || [],
    targetSop: meta.targetSop || null,
    targetAgent: meta.targetAgent || null,
    controlKind: brief.twinOf ? 'twin' : 'none',
    ...(brief.twinOf ? { twinOf: brief.twinOf } : {}),
    loadCheck: meta.loadCheck || { mustLoad: [], mustNotLoad: [] },
    effectSubset: false,
    authorship: {
      family: brief.author.split('-')[0],
      model: brief.author,
      date: '2026-11-19',
      source: brief.source,
    },
    ...(meta.review ? { review: meta.review } : {}),
  };
  fs.writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  return task;
}

if (require.main === module) {
  const [id, work] = process.argv.slice(2);
  const t = assemble(id, path.resolve(work));
  console.log(`${t.id}: ${t.checks.length} checks, fixture ${t.fixture}`);
}
module.exports = { assemble };
