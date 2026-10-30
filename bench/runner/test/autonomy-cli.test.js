// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js run --suite autonomy` and `report` through the real command line, with a fake kiro-cli and a scratch HOME.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeKiro, writeFakeAuth } = require('./fake-kiro.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

test('run --suite autonomy asks, answers, resumes and records the conversation; report prints the Autonomy section', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/t1.json'), JSON.stringify({
      ...t, class: 'autonomy', tiers: ['autonomy'],
      autonomy: { clarifications: [{ id: 'unit', topic: 'unit', keywords: ['seconds'], answer: 'Seconds.' }] },
    }));
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(path.join(root, 'bin'), { dir: probe, sessionJson: true, turns: [{ finalText: 'Seconds or milliseconds?', credits: 1 }, { finalText: 'Done.', credits: 2 }] });
    const home = path.join(root, 'home');
    writeFakeAuth(home);
    const tmpdir = path.join(root, 'tmp');
    fs.mkdirSync(tmpdir);
    const out = path.join(root, 'out');
    const env = { PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: home, TMPDIR: tmpdir };
    const run = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'autonomy', '--arms', 'vanilla', '--tasks', 't1', '--replicates', '1', '--isolate', 'none', '--bench-dir', bench, '--out', out, '--cache', path.join(root, 'cache')], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(fs.readFileSync(path.join(out, 'vanilla/t1/1/result.json'), 'utf8'));
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.turns, 2);
    assert.equal(result.interjections, 1);
    assert.equal(result.credits, 3);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.totalCredits, 3, 'the ledger counts every turn');
    for (const f of ['stream-1.jsonl', 'stream-2.jsonl', 'stream.jsonl']) assert.ok(fs.existsSync(path.join(out, 'vanilla/t1/1', f)), f);

    const report = spawnSync(process.execPath, [BENCH_JS, 'report', '--run', out, '--bench-dir', bench], { env, encoding: 'utf8' });
    assert.equal(report.status, 0, report.stderr);
    assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /## Autonomy[\s\S]*\| vanilla \| 1 \|/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).arms.vanilla.autonomy.autonomy.runs, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown suite lists autonomy among the valid ones', () => {
  const r = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'nightly'], { env: { PATH: process.env.PATH, HOME: tmp() }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /lite\|full\|hard\|real\|autonomy\|pilot/);
});
