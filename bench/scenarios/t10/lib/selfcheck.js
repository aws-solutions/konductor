#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The author's own check of a T10 draft (copied with its helpers into the author's kit/ folder), and the scoring-kit
// builder the stage uses after the author call. It builds the hidden dir from task-draft.json (a design key and a
// rollout key become two kits for the shared block grader), then runs every `tests` check on the reference (fixture
// plus solution) and on the plain fixture (the stub), and estimates the code score the dry run will give.
//   node kit/selfcheck.js [draftDir]    (default: the current directory; needs fixture/, solution/, task-draft.json)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// An author's kit/ copy carries the helpers beside this file instead.
const helper = (name) => [path.join(__dirname, name), path.join(__dirname, '..', '..', 'lib', 'hidden', name)].find((p) => fs.existsSync(p));
const copy = (name, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(helper(name), to); };
const writeKey = (file, key) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(key, null, 2)}\n`); };

/** Builds hidden/ from the draft: the shared block grader, and one key per document (design: block-kit, rollout: rollout-kit). */
function buildHidden(draftDir, draft) {
  const hidden = path.join(draftDir, 'hidden');
  fs.mkdirSync(hidden, { recursive: true });
  if (draft.designKey || draft.rolloutKey) {
    copy('block-key.js', path.join(hidden, 'block-kit/block-key.js'));
    copy('block.test.js', path.join(hidden, 'block.test.js'));
  }
  if (draft.designKey) writeKey(path.join(hidden, 'block-kit/key.json'), draft.designKey);
  if (draft.rolloutKey) writeKey(path.join(hidden, 'rollout-kit/key.json'), draft.rolloutKey);
  return hidden;
}

function runTests(ws, cmd) {
  const env = { ...process.env, TMPDIR: fs.mkdtempSync(path.join(os.tmpdir(), 't10-self-tmp-')) };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('sh', ['-c', cmd], { cwd: ws, env, encoding: 'utf8', timeout: 300000 });
  fs.rmSync(env.TMPDIR, { recursive: true, force: true });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const pass = Number((/^(?:#|ℹ) pass (\d+)/m.exec(out) || [])[1] || 0);
  const fail = Number((/^(?:#|ℹ) fail (\d+)/m.exec(out) || [])[1] || 0);
  const failing = [...new Set([...out.matchAll(/^\s*(?:not ok \d+ - |✖ )(.+?)(?: \([\d.]+ms\))?$/gm)].map((m) => m[1]))].slice(0, 30);
  return { passed: pass, total: pass + fail, failing };
}

function workspace(draftDir, hidden, withSolution) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't10-self-'));
  fs.cpSync(path.join(draftDir, 'fixture'), ws, { recursive: true });
  if (withSolution) fs.cpSync(path.join(draftDir, 'solution'), ws, { recursive: true });
  fs.cpSync(hidden, ws, { recursive: true });
  return ws;
}

// A light version of the bench's check evaluation, enough for the author to see the score the dry run will give.
function evalOther(c, ws, fixtureDir) {
  const read = (rel) => (fs.existsSync(path.join(ws, rel)) ? fs.readFileSync(path.join(ws, rel), 'utf8') : null);
  const re = () => new RegExp(c.pattern, 'i');
  switch (c.type) {
    case 'file_exists': return fs.existsSync(path.join(ws, c.path));
    case 'contains': return re().test(read(c.path) ?? '');
    case 'not_contains': return read(c.path) !== null && !re().test(read(c.path));
    case 'min_matches': return (String(read(c.path) ?? '').match(new RegExp(c.pattern, 'gi')) || []).length >= c.min;
    case 'fixture_unchanged': return read(c.path) === (fs.existsSync(path.join(fixtureDir, c.path)) ? fs.readFileSync(path.join(fixtureDir, c.path), 'utf8') : null);
    case 'cmd': {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      return spawnSync('sh', ['-c', c.cmd], { cwd: ws, env, timeout: 120000 }).status === (c.expectExit ?? 0);
    }
    default: return false;
  }
}

/** The code score the dry run gives: (0.5 hidden share + 0.2 other substance checks share) / 0.7, in percent. */
function estimate(draft, ws, fixtureDir, tests) {
  const total = tests.reduce((n, t) => n + t.total, 0);
  const hidden = total ? tests.reduce((n, t) => n + t.passed, 0) / total : 0;
  const other = draft.checks.filter((c) => c.type !== 'tests' && c.kind !== 'format');
  const w = (c) => (typeof c.weight === 'number' && c.weight >= 0 ? c.weight : 1);
  const all = other.reduce((n, c) => n + w(c), 0);
  const ok = other.reduce((n, c) => n + (evalOther(c, ws, fixtureDir) ? w(c) : 0), 0);
  return Math.round(((all ? (0.5 * hidden + 0.2 * (ok / all)) / 0.7 : hidden) * 1000)) / 10;
}

function main(draftDir = '.') {
  const draft = JSON.parse(fs.readFileSync(path.join(draftDir, 'task-draft.json'), 'utf8'));
  const hidden = buildHidden(draftDir, draft);
  const report = [];
  const scores = {};
  const testChecks = draft.checks.filter((x) => x.type === 'tests');
  for (const [name, withSolution] of [['reference', true], ['stub', false]]) {
    const ws = workspace(draftDir, hidden, withSolution);
    try {
      const runs = testChecks.map((c) => runTests(ws, c.cmd));
      report.push({ answer: name, tests: runs.map((r, i) => ({ cmd: testChecks[i].cmd, min: testChecks[i].min, ...r })) });
      scores[name] = estimate(draft, ws, path.join(draftDir, 'fixture'), runs);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({ estimatedScores: scores, gates: 'reference >= 95, stub <= 20', report }, null, 2));
  return report;
}

if (require.main === module) main(process.argv[2]);
module.exports = { main, buildHidden, helper };
