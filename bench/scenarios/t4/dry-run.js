#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of T4 tasks (plan 4.6): the reference (fixture plus solution overlay) must score at least 95 and a stub
// (the untouched fixture, the empty change) 20 or less, on the code-scored parts only (hidden tests 0.5, substance checks
// 0.2, renormalised; the rubric needs judges and is left out). Each workspace is scored `--repeat` times (default 3)
// and every check must give the same result each time.
// Usage: node dry-run.js [--repeat N] [--json] [id ...]   (no ids: every t4-*.json in this directory)
// Scratch goes under $TMPDIR and is removed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChecks } = require('../../runner/lib/checks.js');

const DIR = __dirname;
const W_HIDDEN = 0.5;
const W_CHECKS = 0.2;

function copyTree(from, to) {
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

function overlay(root, solutionDir) {
  if (!fs.existsSync(solutionDir)) return;
  const del = path.join(solutionDir, 'DELETE.txt');
  if (fs.existsSync(del)) {
    for (const line of fs.readFileSync(del, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) {
      fs.rmSync(path.join(root, line), { recursive: true, force: true });
    }
  }
  for (const name of fs.readdirSync(solutionDir)) {
    if (name === 'DELETE.txt') continue;
    fs.cpSync(path.join(solutionDir, name), path.join(root, name), { recursive: true, force: true, verbatimSymlinks: true });
  }
}

/** Code-scored quality 0..100 from check results: the tests check's pass fraction and the weighted substance checks. */
function codeScore(results) {
  const tests = results.find((r) => r.type === 'tests');
  const hidden = tests && tests.tests && tests.tests.total > 0 ? tests.tests.passed / tests.tests.total : null;
  const scored = results.filter((r) => r.type !== 'tests' && r.kind !== 'format');
  const w = (r) => (typeof r.weight === 'number' ? r.weight : 1);
  const total = scored.reduce((n, r) => n + w(r), 0);
  const checks = total > 0 ? scored.reduce((n, r) => n + (r.passed ? w(r) : 0), 0) / total : null;
  const parts = [[hidden, W_HIDDEN], [checks, W_CHECKS]].filter(([v]) => v !== null);
  if (!parts.length) return { score: null, hidden, checks };
  const sum = parts.reduce((n, [, wt]) => n + wt, 0);
  return { score: (parts.reduce((n, [v, wt]) => n + v * wt, 0) / sum) * 100, hidden, checks };
}

function scoreWorkspace(task, kind, scratchParent) {
  const fixture = path.join(DIR, 'fixtures', task.fixture);
  const ws = fs.mkdtempSync(path.join(scratchParent, `${kind}-`));
  copyTree(fixture, ws);
  if (kind === 'reference') overlay(ws, path.join(DIR, 'solutions', task.id));
  const results = runChecks(ws, task.checks, { pristineDir: fixture, hiddenDir: path.join(DIR, 'hidden', task.hidden), scratchDir: scratchParent });
  fs.rmSync(ws, { recursive: true, force: true });
  return { ...codeScore(results), results };
}

function dryRun(id, repeat) {
  const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `t4-dry-${id}-`));
  try {
    const out = { id, reference: [], stub: [], flaky: [] };
    for (let i = 0; i < repeat; i += 1) {
      for (const kind of ['reference', 'stub']) out[kind].push(scoreWorkspace(task, kind, scratch));
    }
    for (const kind of ['reference', 'stub']) {
      const runs = out[kind];
      runs[0].results.forEach((r, j) => {
        if (runs.some((x) => x.results[j].passed !== r.passed || (r.tests && x.results[j].tests?.passed !== r.tests.passed))) out.flaky.push(`${kind} check ${j} (${r.type})`);
      });
    }
    const ref = out.reference[0];
    const stub = out.stub[0];
    const failedRef = ref.results.map((r, j) => ({ ...r, j })).filter((r) => !r.passed).map((r) => `${r.j}:${r.type} ${r.detail}`);
    return {
      id,
      reference: ref.score, stub: stub.score,
      referenceHidden: ref.hidden, stubHidden: stub.hidden,
      ok: ref.score >= 95 && stub.score <= 20 && !out.flaky.length,
      failedOnReference: failedRef,
      flaky: out.flaky,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let repeat = 3;
  let json = false;
  const ids = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--repeat') repeat = Number(args[++i]);
    else if (args[i] === '--json') json = true;
    else ids.push(args[i]);
  }
  const list = ids.length ? ids : fs.readdirSync(DIR).filter((f) => /^t4-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();
  const rows = list.map((id) => dryRun(id, repeat));
  if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else {
    for (const r of rows) {
      const f = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(1));
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: reference ${f(r.reference)}, stub ${f(r.stub)}${r.flaky.length ? `, flaky: ${r.flaky.join('; ')}` : ''}${r.failedOnReference.length ? `, reference fails: ${r.failedOnReference.join(' | ')}` : ''}`);
    }
  }
  process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
}

module.exports = { dryRun, codeScore, overlay };
