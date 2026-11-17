// SPDX-License-Identifier: Apache-2.0
'use strict';

// --introspect on kiro-cli, with the fake kiro-cli: the engine's request dumps are written next to the run root, never
// inside the agent's working directory or HOME, are copied to <run>/introspect/kiro and are removed with the run root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { probeUnshare } = require('../lib/isolate.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v3' };
const unshare = probeUnshare();

function setup(mode) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, dumpRequests: true });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    introspect: true,
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const cleanup = () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); };
  return { ctx, task: loadTasks(bench).get('t1'), scratchDir, outDir: path.join(root, 'out', 't1'), cleanup };
}

const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);

async function checkDumpOutsideRunRoot(mode) {
  const s = setup(mode);
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error ?? '');
    assert.ok(r.flags.includes('introspect'));
    const copied = path.join(s.outDir, 'introspect', 'kiro', 'requests', 'sess_fake', '0000-1000.json');
    const dump = JSON.parse(fs.readFileSync(copied, 'utf8'));
    const runRoot = path.dirname(dump.cwd);
    assert.equal(path.basename(dump.cwd), 'work');
    assert.equal(dump.dumpDir, path.join(`${runRoot}-introspect`, 'requests'));
    for (const dir of [runRoot, dump.cwd, dump.home]) assert.equal(inside(dump.dumpDir, dir), false, `${dump.dumpDir} is inside ${dir}`);
    const rec = JSON.parse(fs.readFileSync(path.join(s.outDir, 'introspect', 'probe.json'), 'utf8'));
    assert.deepEqual(rec.copied.kiroDumps.copied, [path.join('requests', 'sess_fake', '0000-1000.json')]);
    assert.equal(rec.kiroDumpRoot.outsideRunRoot, true);
    assert.deepEqual(fs.readdirSync(s.scratchDir), [], 'the run root and the dump directory are removed');
  } finally {
    s.cleanup();
  }
}

test('kiro-cli request dumps go to a sibling of the run root, are copied out and removed', () => checkDumpOutsideRunRoot('none'));

test('inside the namespace the engine can write the sibling dump directory', { skip: unshare.ok ? false : `unshare namespace unavailable: ${unshare.reason}` }, () => checkDumpOutsideRunRoot('unshare'));
