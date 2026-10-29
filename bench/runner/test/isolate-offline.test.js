// SPDX-License-Identifier: Apache-2.0
'use strict';

// The offline variant of the namespace used for the checks of real-repository tasks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { makeIsolation, probeUnshare, UNSHARE_FLAGS } = require('../lib/isolate.js');
const { makeScratchRoot } = require('../lib/sandbox.js');

test('offline adds a network namespace and brings loopback up before the capabilities are dropped', () => {
  const scratch = makeScratchRoot();
  try {
    const on = makeIsolation({ mode: 'unshare', scratchRoot: scratch, offline: true });
    const off = makeIsolation({ mode: 'unshare', scratchRoot: scratch });
    assert.ok(on.wrap('sh', []).args.includes('--net'));
    assert.equal(off.wrap('sh', []).args.includes('--net'), false);
    assert.deepEqual(off.wrap('sh', []).args.slice(0, UNSHARE_FLAGS.length), UNSHARE_FLAGS);
    assert.match(on.script, /ip' link set lo up/);
    assert.ok(on.script.indexOf("' link set lo up") < on.script.indexOf('setpriv'), 'loopback is configured while the namespace still has capabilities');
    assert.doesNotMatch(off.script, /ip' link set lo up/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('offline mode off or unshare off passes commands through unchanged', () => {
  const iso = makeIsolation({ mode: 'none', scratchRoot: '/nonexistent', offline: true });
  assert.deepEqual(iso.wrap('sh', ['-c', 'true']), { file: 'sh', args: ['-c', 'true'] });
});

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

const CONNECT = `
const net = require('node:net');
const [host, port] = process.argv.slice(1);
const s = net.connect({ host, port: Number(port), timeout: 3000 });
s.on('connect', () => { console.log('connected'); process.exit(0); });
s.on('error', (e) => { console.log('error ' + e.code); process.exit(1); });
s.on('timeout', () => { console.log('timeout'); process.exit(1); });
`;

const LOOPBACK = `
const net = require('node:net');
const srv = net.createServer((c) => c.end('ok')).listen(0, '127.0.0.1', () => {
  const c = net.connect(srv.address().port, '127.0.0.1');
  c.on('data', () => { console.log('loopback ok'); process.exit(0); });
  c.on('error', (e) => { console.log('loopback ' + e.code); process.exit(2); });
});
`;

function run(iso, script, args = []) {
  const w = iso.wrap(process.execPath, ['-e', script, ...args]);
  return spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 30000 });
}

test('offline: an outbound connection fails and loopback works', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, offline: true });
    const out = run(iso, CONNECT, ['1.1.1.1', '443']);
    assert.notEqual(out.status, 0, `outbound connect must fail: ${out.stdout}`);
    assert.doesNotMatch(out.stdout, /connected/);
    const lo = run(iso, LOOPBACK);
    assert.equal(lo.status, 0, `${lo.stdout} ${lo.stderr}`);
    assert.match(lo.stdout, /loopback ok/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('offline: the agent-side isolation keeps the network', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch });
    const lo = run(iso, LOOPBACK);
    assert.equal(lo.status, 0, `${lo.stdout} ${lo.stderr}`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
