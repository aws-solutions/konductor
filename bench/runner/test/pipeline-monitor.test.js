// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/monitor.sh: the dashboard is read-only and renders every verdict from a fake state directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sandbox, makePatch, chain, out, opts } = require('./pipeline-helpers.js');

const HAS_JQ = spawnSync('jq', ['--version']).status === 0;
const jqOpts = HAS_JQ ? opts : { skip: 'jq is not installed' };

// Wide enough that the monitor clips no line, so the assertions hold whatever the length of the repo or temp path.
function mon(s, args = [], extra = {}) {
  return s.spawn('monitor.sh', args, { STATE_DIR: s.state, MON_PROC_RE: 'no-such-process-pattern', MON_DISK_PATH: s.root, MON_COLS: '1000', ...extra });
}
const listing = (dir) => fs.readdirSync(dir).sort();

test('with no state file the monitor says the chain has not started and tells the operator how to start it', opts, () => {
  const s = sandbox();
  try {
    const r = mon(s);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /=== KONDUCTOR PIPELINE MONITOR ===/);
    assert.match(r.stdout, /CHAIN +not started \(no state file: /);
    assert.match(r.stdout, /VERDICT +ATTENTION: the chain has not been started/);
    assert.match(r.stdout, /TO-DO +start it: bash \S+run-after-capability\.sh/);
    assert.deepEqual(listing(s.state), []);
  } finally { s.done(); }
});

test('after a finished run it shows DONE, skipped optional phases, and writes nothing unless --save is given', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    assert.equal(s.spawn('run-after-capability.sh', ['--foreground'], env).status, 0);
    const before = listing(s.state);
    const r = mon(s);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /CHAIN +FINISHED \(final=DONE\)/);
    assert.match(r.stdout, /\[-\] P2 PATCH +skipped +skipped \(no patches given\)/);
    assert.match(r.stdout, /\[-\] P3 AUTONOMY +skipped/);
    assert.match(r.stdout, /\[x\] P6 SUMMARY +done/);
    assert.match(r.stdout, /VERDICT +DONE: all six phases are complete/);
    assert.deepEqual(listing(s.state), before, 'read-only');
    const saved = mon(s, ['--save']);
    assert.equal(saved.status, 0);
    assert.deepEqual(listing(s.state), [...before, 'monitor.last.txt'].sort());
    assert.match(fs.readFileSync(path.join(s.state, 'monitor.last.txt'), 'utf8'), /VERDICT +DONE/);
    const all = mon(s, ['--all']);
    assert.match(all.stdout, /=== CAPABILITY STUDY SUMMARY \(--all\) ===/);
  } finally { s.done(); }
});

test('P2 shows every commit the patches made', opts, () => {
  const s = sandbox();
  try {
    const p1 = makePatch(s, 'p1', { 'bench/one.txt': 'one\n' });
    const p2 = makePatch(s, 'p2', { 'bench/two.txt': 'two\n' }, { subject: 'feat(bench): two' });
    const { env } = chain(s, { PATCHES: `${p1},${p2}` });
    assert.equal(s.spawn('run-after-capability.sh', ['--foreground'], env).status, 0);
    const r = mon(s);
    assert.match(r.stdout, /\[x\] P2 PATCH +done +\d+ tests, 0 fail \(\d+ pass, \d+ skipped\), commits [0-9a-f]{8}, [0-9a-f]{8}/);
  } finally { s.done(); }
});

test('a failed phase shows FAILED with the reason, and a dead chain with no DONE asks for a resume', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    fs.writeFileSync(path.join(s.state, 'real-pilot.log'), '[2026-01-01T00:00:00Z] FAILED: 1/2 task dirs complete\n');
    assert.equal(s.spawn('run-after-capability.sh', ['--foreground'], env).status, 1);
    const r = mon(s);
    assert.match(r.stdout, /\[!\] P1 WAIT +failed +FAILED: the capability study ended FAILED/);
    assert.match(r.stdout, /VERDICT +FAILED: P1 WAIT/);
    assert.match(r.stdout, /TO-DO +fix the cause, then resume with: bash \S+run-after-capability\.sh/);
    fs.writeFileSync(path.join(s.state, 'after-capability.state'), 'FINAL=running\nP1=done\nP2=skipped\nP3=skipped\nP4=running\nCURRENT=4\n');
    const dead = mon(s);
    assert.match(dead.stdout, /CHAIN +NOT RUNNING/);
    assert.match(dead.stdout, /VERDICT +ATTENTION: chain not running/);
  } finally { s.done(); }
});

test('a credentials wait tells the operator to re-vend to the path in the log, never to "the assistant"', opts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    fs.writeFileSync(path.join(s.state, 'after-capability.state'), 'FINAL=running\nP1=done\nP2=skipped\nP3=skipped\nP4=running\nCURRENT=4\nWAITING_FOR_CREDENTIALS=judging x since now\n');
    fs.writeFileSync(path.join(s.state, 'after-capability.log'), `[2026-01-01T00:00:00Z] WAITING FOR CREDENTIALS: re-vend the credentials to ${s.creds}  (needed for judging x)\n`);
    fs.writeFileSync(path.join(s.state, 'after-capability.pid'), `${process.pid}\n`);
    const r = mon(s, [], env);
    assert.match(r.stdout, /WAITING FOR CREDENTIALS: YES \(re-vend the credentials to the path shown\)/);
    assert.match(r.stdout, /re-vend the credentials to \S*creds/);
    assert.doesNotMatch(r.stdout, /assistant/i);
  } finally { s.done(); }
});

test('--json is one valid document with the verdict, and it cannot be combined with --watch', jqOpts, () => {
  const s = sandbox();
  try {
    const { env } = chain(s);
    assert.equal(s.spawn('run-after-capability.sh', ['--foreground'], env).status, 0);
    const r = mon(s, ['--json']);
    assert.equal(r.status, 0, out(r));
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.verdict.status, 'DONE');
    assert.equal(doc.phases.length, 6);
    assert.deepEqual(doc.phases.map((p) => p.state), ['done', 'skipped', 'skipped', 'done', 'done', 'done']);
    assert.equal(doc.chain.alive, false);
    const bad = mon(s, ['--json', '--watch']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--json cannot be combined with --watch/);
  } finally { s.done(); }
});
