// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { REINIT_PREFIX, LOST } = require('../lib/plant/shim.js');
const { plantAgent, writePlantAgent, copyPlantAgentOut } = require('../lib/plant/agent-file.js');
const { startGateway, ownPidns } = require('../lib/plant/launch.js');

const SHIM = path.join(__dirname, '..', 'lib', 'plant', 'shim.js');
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'physical', 'fixtures', 'mcp-conformance.json'), 'utf8')).vectors;
const INIT = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };

const made = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const lineOf = (obj) => JSON.stringify(obj) + '\n';

/** Collects JSON lines from `stream`; `next()` waits for the next one. */
function lineQueue(stream) {
  const lines = [];
  const waiters = [];
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let at;
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at);
      buf = buf.slice(at + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  return {
    next: (ms = 5000) => (lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no line')), ms);
      waiters.push((l) => { clearTimeout(timer); resolve(l); });
    })),
    lines,
  };
}

/** A fake gateway on a Unix socket. `onConn(sock, queue, index)` scripts each connection. */
function fakeGateway(t, socketPath, onConn) {
  const conns = [];
  t.after(() => { for (const c of conns) c.sock.destroy(); server.close(); });
  const server = net.createServer((sock) => {
    const queue = lineQueue(sock);
    conns.push({ sock, queue });
    onConn(sock, queue, conns.length - 1);
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve({ server, conns })));
}

function startShim(t, socketPath) {
  const child = spawn(process.execPath, [SHIM, socketPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  return { child, out: lineQueue(child.stdout), send: (obj) => child.stdin.write(typeof obj === 'string' ? obj + '\n' : lineOf(obj)) };
}

test('the shim copies agent lines to the gateway byte for byte and replies back unchanged', async (t) => {
  const dir = tmpDir();
  const sockPath = path.join(dir, 'gw.sock');
  const raw = '{"jsonrpc":"2.0","id":"x-1","method":"ping",  "params":{}}';
  await fakeGateway(t, sockPath, async (sock, queue) => {
    assert.equal(await queue.next(), raw);
    sock.write('{"jsonrpc":"2.0","id":"x-1","result":{}}\n');
  });
  const shim = startShim(t, sockPath);
  shim.send(raw);
  assert.equal(await shim.out.next(), '{"jsonrpc":"2.0","id":"x-1","result":{}}');
  shim.child.stdin.end();
  await new Promise((r) => shim.child.once('exit', r));
});

test('a request open when the socket closes is answered with -32000 plant connection lost', async (t) => {
  const dir = tmpDir();
  const sockPath = path.join(dir, 'gw.sock');
  await fakeGateway(t, sockPath, async (sock, queue) => {
    await queue.next();
    sock.destroy();
  });
  const shim = startShim(t, sockPath);
  shim.send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'set_speed', arguments: { speed_mmps: 900 } } });
  assert.deepEqual(JSON.parse(await shim.out.next()), { jsonrpc: '2.0', id: 7, error: { code: -32000, message: LOST } });
});

test('after a loss the shim reconnects, replays initialize under its own id, and drops that reply', async (t) => {
  const dir = tmpDir();
  const sockPath = path.join(dir, 'gw.sock');
  const seen = [];
  await fakeGateway(t, sockPath, async (sock, queue, index) => {
    if (index === 0) {
      const init = JSON.parse(await queue.next());
      sock.write(lineOf({ jsonrpc: '2.0', id: init.id, result: {} }));
      await queue.next();
      await queue.next();
      sock.destroy();
      return;
    }
    for (let i = 0; i < 3; i += 1) seen.push(JSON.parse(await queue.next()));
    sock.write(lineOf({ jsonrpc: '2.0', id: seen[0].id, result: { replayed: true } }));
    sock.write(lineOf({ jsonrpc: '2.0', id: seen[2].id, result: { ok: true } }));
  });
  const shim = startShim(t, sockPath);
  shim.send(INIT);
  await shim.out.next();
  shim.send(INITIALIZED);
  shim.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'stop', arguments: {} } });
  assert.equal(JSON.parse(await shim.out.next()).error.code, -32000);
  shim.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_state', arguments: {} } });
  assert.deepEqual(JSON.parse(await shim.out.next()), { jsonrpc: '2.0', id: 2, result: { ok: true } });
  assert.deepEqual(seen.map((m) => [m.id, m.method]), [[`${REINIT_PREFIX}1`, 'initialize'], [undefined, 'notifications/initialized'], [2, 'tools/call']]);
  assert.equal(shim.out.lines.length, 0);
});

test('the shim exits 0 when the agent closes its stdin', async (t) => {
  const dir = tmpDir();
  const sockPath = path.join(dir, 'gw.sock');
  await fakeGateway(t, sockPath, () => {});
  const shim = startShim(t, sockPath);
  shim.child.stdin.end();
  assert.equal(await new Promise((r) => shim.child.once('exit', r)), 0);
});

test('every shared conformance vector gets the same answer through the shim from the real gateway', async (t) => {
  const dir = tmpDir();
  const task = path.join(dir, 'task.json');
  fs.writeFileSync(task, JSON.stringify({ environment: { start: { running: true, speed_mmps: 600, rated_max_mmps: 1000 } } }));
  const sockPath = path.join(dir, 'gw.sock');
  const gw = await startGateway({ taskFile: task, logDir: dir, socketPath: sockPath });
  t.after(() => gw.kill());
  gw.peer(ownPidns());
  for (const vector of VECTORS) {
    const shim = startShim(t, sockPath);
    if (vector.init) {
      shim.send(INIT);
      await shim.out.next();
    }
    shim.send(vector.raw);
    if (vector.expect.none) {
      shim.send({ jsonrpc: '2.0', id: 'probe', method: 'ping' });
      assert.equal(JSON.parse(await shim.out.next()).id, vector.init ? 'probe' : null, vector.name);
    } else {
      const reply = JSON.parse(await shim.out.next());
      if ('error' in vector.expect) assert.equal(reply.error?.code, vector.expect.error, vector.name);
      else assert.equal(reply.result?.isError ?? false, vector.expect.isError ?? false, vector.name);
    }
    shim.child.stdin.end();
    await new Promise((r) => shim.child.once('exit', r));
  }
  const { final, code } = await gw.stop();
  assert.equal(code, 0);
  assert.ok(final.lines.gateway > VECTORS.length);
});

test('the plant agent lists built-ins by name, never @builtin or a spawn tool, and runs the shim on the socket', () => {
  const agent = plantAgent({ shimPath: '/run/plant/shim.js', socketPath: '/run/s/gw.sock', nodeBin: '/usr/bin/node' });
  assert.ok(agent.tools.includes('@plant'));
  assert.ok(!agent.tools.includes('@builtin'));
  assert.ok(!agent.tools.includes('subagent'));
  assert.deepEqual(agent.mcpServers.plant, { command: '/usr/bin/node', args: ['/run/plant/shim.js', '/run/s/gw.sock'], env: {} });
});

test('the agent file is written once into the scratch HOME and copied out', () => {
  const home = tmpDir();
  const out = tmpDir();
  const opts = { shimPath: '/s.js', socketPath: '/g.sock', nodeBin: 'node' };
  writePlantAgent(home, opts);
  assert.throws(() => writePlantAgent(home, opts), /EEXIST/);
  assert.ok(copyPlantAgentOut(home, out) > 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'installed-agent.json'), 'utf8')).name, 'plant');
});

test('copying the agent file out refuses a symlinked agents directory', () => {
  const home = tmpDir();
  const elsewhere = tmpDir();
  fs.mkdirSync(path.join(home, '.kiro'));
  fs.mkdirSync(path.join(elsewhere, 'agents'));
  fs.writeFileSync(path.join(elsewhere, 'agents', 'plant.json'), '{}');
  fs.symlinkSync(path.join(elsewhere, 'agents'), path.join(home, '.kiro', 'agents'));
  assert.throws(() => copyPlantAgentOut(home, tmpDir()), /symlink/);
});
