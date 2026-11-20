#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The author's own check of a T11 draft: the shared free dry run (bench/scenarios/lib/dry-run.js) over the draft dir,
// before the task is assembled into the batch. The author's kit/selfcheck.js calls it.
//   node selfcheck.js <draftDir>    (needs fixture/, hidden/, solution/, task-draft.json; alt/ and lazy/ when written)
// Prints the estimated score of each answer, the gates, and the checks each answer fails.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../../lib/config.js');
const { dryRun } = require('../../lib/dry-run.js');
const { GIT_ENV, modesOf } = require('./modes.js');
const { buildHidden } = require('./hidden.js');

/** The draft as a task the dry run can load (only the fields the checks read). */
function draftTask(draft, id) {
  return { id, class: 'hard', prompt: draft.prompt || '-', timeoutSec: 600, checks: draft.checks || [], rubric: draft.rubric || [], tiers: ['full'], fixture: id, hidden: id };
}

function check(draftDir, { fixtureDir = null } = {}) {
  const dir = path.resolve(draftDir);
  const draft = JSON.parse(fs.readFileSync(path.join(dir, 'task-draft.json'), 'utf8'));
  buildHidden(dir, draft);
  const id = draft.id || path.basename(dir);
  const task = draftTask(draft, id);
  const cfg = loadConfig({
    dir, ids: () => [id],
    fixtureDir: () => fixtureDir || path.join(dir, 'fixture'), hiddenDir: () => path.join(dir, 'hidden'),
    modes: () => modesOf({ solution: path.join(dir, 'solution'), lazy: path.join(dir, 'lazy'), alt: path.join(dir, 'alt'), shallow: path.join(dir, 'shallow') }),
    env: GIT_ENV,
  });
  cfg.readTask = () => task;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-'));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    const res = dryRun(id, cfg, { repeat: 2 });
    delete res.gates.loads;
    const failing = Object.fromEntries(Object.entries(res.modes).map(([k, m]) => [k, m.results.filter((r) => !r.passed && r.kind === 'substance').map((r) => `#${r.i} ${r.type}: ${String(r.detail || '').slice(0, 300)}`)]));
    return { estimatedScores: res.scores, gates: res.gates, deterministic: res.deterministic, failing };
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) console.log(JSON.stringify(check(process.argv[2] || '.', { fixtureDir: process.argv[3] || null }), null, 2));
module.exports = { check, draftTask };
