#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of one T5 task (no model call): scores the reference solution and a stub with the bench's own check code,
// repeats the run to prove the checks are deterministic, and proves that a hung mutant (or test) fails alone.
//   node dry-run.js <task-id> [--repeat 3] [--json]
// Layout under bench/scenarios/t5/: <id>.json, fixtures/<id>/, hidden/<id>/ (copied over the workspace root),
// solutions/<id>/ (overlay on the fixture). The stub is the untouched fixture. Scoring is T1's `scoreOf`.
// shortcut: workspace and runChecks repeat T1's dry-run.js with T5's directory; fold both into one module when a third batch needs it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck } = require('../../runner/lib/check-matcher.js');
const { scoreOf } = require('../t1/dry-run.js');

const DIR = __dirname;
const signature = (results) => JSON.stringify(results.map((r) => [r.type, r.passed, r.tests ? [r.tests.passed, r.tests.total] : null]));

// `reference` is true (the solution overlay), false (the stub) or a variant { name, overlay } (any answer overlay).
function workspace(root, id, reference, dir = DIR) {
  const ws = path.join(root, reference === true ? 'ref' : reference ? `variant-${reference.name}` : 'stub');
  fs.cpSync(path.join(dir, 'fixtures', id), ws, { recursive: true });
  if (reference === true) fs.cpSync(path.join(dir, 'solutions', id), ws, { recursive: true });
  else if (reference) fs.cpSync(reference.overlay, ws, { recursive: true });
  return ws;
}

function runChecks(task, ws, id, env, scratchDir, dir = DIR) {
  return task.checks.map((c) => {
    let r;
    try {
      r = evalCheck(ws, c, { pristineDir: path.join(dir, 'fixtures', id), hiddenDir: path.join(dir, 'hidden', id), env, scratchDir });
    } catch (e) {
      r = { passed: false, detail: e.message };
    }
    return { type: c.type, weight: c.weight, kind: c.kind, passed: r.passed, detail: r.detail, ...(r.tests ? { tests: r.tests } : {}) };
  });
}

// `dir` is the batch directory (default T5's); T8 reuses this scorer with its own.
// `variants` ({ name: overlayDir }) are other answers to score once each, for example a lazy and an alternative answer.
function dryRun(id, { repeat = 3, dir = DIR, variants = {} } = {}) {
  const task = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `dry-${id}-`));
  try {
    const env = { ...process.env, TMPDIR: path.join(root, 'tmp') };
    delete env.NODE_TEST_CONTEXT;
    fs.mkdirSync(env.TMPDIR);
    const out = { id, repeat, reference: null, stub: null, deterministic: true };
    for (const [mode, ref] of [['reference', true], ['stub', false]]) {
      const ws = workspace(root, id, ref, dir);
      const runs = [];
      for (let i = 0; i < repeat; i++) runs.push(runChecks(task, ws, id, env, path.join(root, 'scratch'), dir));
      if (new Set(runs.map(signature)).size > 1) out.deterministic = false;
      out[mode] = { ...scoreOf(runs[0]), checks_: runs[0].map((r) => ({ type: r.type, kind: r.kind, weight: r.weight, passed: r.passed, detail: r.detail })) };
    }
    out.variants = {};
    for (const [name, overlay] of Object.entries(variants)) {
      const ws = workspace(root, id, { name, overlay }, dir);
      out.variants[name] = scoreOf(runChecks(task, ws, id, env, path.join(root, 'scratch'), dir));
    }
    out.pass = out.reference.score >= 95 && out.stub.score <= 20 && out.deterministic;
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const repeat = args.includes('--repeat') ? Number(args[args.indexOf('--repeat') + 1]) : 3;
  const res = dryRun(id, { repeat });
  const brief = (m) => ({ score: Number(m.score.toFixed(1)), hidden: m.hidden, checks: m.checks });
  console.log(JSON.stringify(args.includes('--json') ? res : { id, reference: brief(res.reference), stub: brief(res.stub), deterministic: res.deterministic, pass: res.pass }, null, 2));
  if (!res.pass) process.exitCode = 1;
}

module.exports = { dryRun };
