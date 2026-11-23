// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner log (FW-29, DEBT D-223): every console line of `bench run` is also a JSON line in <out>/runner.log, and the
// run writes structured start, cell and end events beside them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { makeRunnerLog } = require('../lib/log.js');
const { cmdRun } = require('../lib/run-cmd.js');

const readLog = (dir) => fs.readFileSync(path.join(dir, 'runner.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('makeRunnerLog: lines before attach are kept, events carry level and fields, the console sees text only', () => {
  const dir = tmp();
  const seen = [];
  try {
    const log = makeRunnerLog({ write: (s) => seen.push(s), now: () => new Date('2026-11-23T01:02:03Z') });
    log('before the out dir');
    log.attach(dir);
    log.event('warn', 'cell', { arm: 'vanilla', status: 'error' });
    log('after');
    const lines = readLog(dir);
    assert.deepEqual(lines.map((l) => [l.level, l.event]), [['info', 'message'], ['warn', 'cell'], ['info', 'message']]);
    assert.equal(lines[0].msg, 'before the out dir');
    assert.equal(lines[1].arm, 'vanilla');
    assert.equal(lines[0].t, '2026-11-23T01:02:03.000Z');
    assert.deepEqual(seen, ['[bench 01:02:03] before the out dir', '[bench 01:02:03] after']);
    assert.throws(() => log.event('loud', 'x'), /level/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a fake run writes runner.log with start, one cell per run, and end', async () => {
  const root = tmp();
  const prev = process.env.PATH;
  const write = process.stderr.write;
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(path.join(root, 'probe'));
    makeFakeKiro(bin, { dir: path.join(root, 'probe') });
    const auth = path.join(root, 'data.sqlite3');
    fs.writeFileSync(auth, 'fake');
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    process.stderr.write = () => true;
    const out = path.join(root, 'out');
    await cmdRun({ suite: 'lite', arms: 'vanilla', replicates: '2', 'budget-credits': '5', 'bench-dir': bench, 'repo-root': path.join(__dirname, '..', '..', '..'), out, cache: path.join(root, 'cache'), isolate: 'none', 'allow-unisolated': true, 'auth-db': auth, seed: '1' });
    process.stderr.write = write;
    const code = process.exitCode;
    process.exitCode = undefined;
    const lines = readLog(out);
    // The run's own exit status shows in the end event: a gate failure sets exit code 4 and an error-level end.
    assert.equal(lines.filter((l) => l.event === 'end')[0].level, code === 4 ? 'error' : 'info');
    const events = lines.filter((l) => l.event !== 'message');
    assert.equal(events[0].event, 'start');
    assert.equal(events.at(-1).event, 'end');
    const cells = events.filter((l) => l.event === 'cell');
    assert.ok(cells.length >= 2, `cells: ${cells.length}`);
    for (const c of cells) assert.deepEqual(Object.keys(c).filter((k) => ['arm', 'task', 'replicate', 'status'].includes(k)).sort(), ['arm', 'replicate', 'status', 'task']);
    assert.ok(lines.some((l) => l.event === 'message' && /^done /.test(l.msg)), 'the console lines are in the log too');
  } finally {
    process.stderr.write = write;
    process.env.PATH = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
