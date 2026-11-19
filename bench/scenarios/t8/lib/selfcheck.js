#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The author's own check of a T8 draft (copied into the author's kit/ folder): builds the hidden dir from
// task-draft.json, then runs every `tests` check on fixture + solution (the reference) and on the plain fixture (the stub).
//   node kit/selfcheck.js [draftDir]    (default: the current directory; needs fixture/, solution/, task-draft.json)
// Prints, per tests check, passed/total for the reference and the stub, and the failing test names of the reference.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { addBlockKit, addRegressKit } = require('./build-hidden.js');

function buildHidden(draftDir, draft) {
  const hidden = path.join(draftDir, 'hidden');
  fs.mkdirSync(hidden, { recursive: true });
  if (draft.blockKey) addBlockKit(hidden, draft.blockKey);
  if (fs.existsSync(path.join(hidden, 'regress-kit/config.json'))) addRegressKit(hidden);
  return hidden;
}

function runTests(ws, cmd) {
  const env = { ...process.env, TMPDIR: fs.mkdtempSync(path.join(os.tmpdir(), 't8-self-tmp-')) };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('sh', ['-c', cmd], { cwd: ws, env, encoding: 'utf8', timeout: 300000 });
  fs.rmSync(env.TMPDIR, { recursive: true, force: true });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const pass = Number((/^(?:#|ℹ) pass (\d+)/m.exec(out) || [])[1] || 0);
  const fail = Number((/^(?:#|ℹ) fail (\d+)/m.exec(out) || [])[1] || 0);
  const failing = [...new Set([...out.matchAll(/^\s*(?:not ok \d+ - |✖ )(.+?)(?: \([\d.]+ms\))?$/gm)].map((m) => m[1]))].slice(0, 30);
  return { pass, total: pass + fail, failing };
}

function workspace(draftDir, hidden, withSolution) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't8-self-'));
  fs.cpSync(path.join(draftDir, 'fixture'), ws, { recursive: true });
  if (withSolution) fs.cpSync(path.join(draftDir, 'solution'), ws, { recursive: true });
  fs.cpSync(hidden, ws, { recursive: true });
  return ws;
}

function main(draftDir = '.') {
  const draft = JSON.parse(fs.readFileSync(path.join(draftDir, 'task-draft.json'), 'utf8'));
  const hidden = buildHidden(draftDir, draft);
  const report = [];
  for (const c of draft.checks.filter((x) => x.type === 'tests')) {
    const row = { cmd: c.cmd };
    for (const [name, sol] of [['reference', true], ['stub', false]]) {
      const ws = workspace(draftDir, hidden, sol);
      try { row[name] = runTests(ws, c.cmd); } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }
    report.push(row);
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) main(process.argv[2]);
module.exports = { main, buildHidden };
