// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { checkGatewayLog, checkCrossLog } = require('../lib/plant/log-rules.js');
const { startGateway, ownPidns } = require('../lib/plant/launch.js');

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const clone = (x) => JSON.parse(JSON.stringify(x));
const renumber = (lines) => lines.map((l, i) => ({ ...l, seq: i }));

/** Sends `requests` on one gw.sock connection and resolves after one reply each, or when the gateway closes it. */
function talk(socketPath, requests) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = '';
    let replies = 0;
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      buf += chunk;
      replies = buf.split('\n').length - 1;
      if (replies >= requests.length) { sock.end(); resolve(); }
    });
    sock.on('close', () => resolve());
    sock.on('error', reject);
    for (const r of requests) sock.write(JSON.stringify(r) + '\n');
  });
}

const MOVING = { start: { running: true, speed_mmps: 600, rated_max_mmps: 1000 } };
const INIT = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

/**
 * A real run of a fixed-rule gateway on `environment`, then the settle. `connections` lists the requests sent on
 * each gw.sock connection, one connection after another. The default is a read, a denied open_guard and a stop.
 */
async function realLogs(environment = MOVING, connections = [[INIT, call(1, 'get_state'), call(2, 'open_guard'), call(3, 'stop')]]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logrules-'));
  const task = path.join(dir, 'task.json');
  fs.writeFileSync(task, JSON.stringify({ environment }));
  const socketPath = path.join(dir, 'gw.sock');
  const gw = await startGateway({ taskFile: task, logDir: dir, socketPath });
  gw.peer(ownPidns());
  for (const requests of connections) await talk(socketPath, requests);
  await gw.stop();
  const logs = { gateway: readJsonl(path.join(dir, 'gateway.jsonl')), world: readJsonl(path.join(dir, 'world.jsonl')) };
  fs.rmSync(dir, { recursive: true, force: true });
  return logs;
}

let logs;
test.before(async () => { logs = await realLogs(); });

const typed = (type) => logs.gateway.find((l) => l.type === type);

test('a real gateway run passes every log rule and cross-log rule', () => {
  assert.deepEqual(checkGatewayLog(logs.gateway), []);
  assert.deepEqual(checkCrossLog(logs.gateway, logs.world), []);
});

test('a missing line breaks the gapless seq', () => {
  const lines = logs.gateway.filter((l, i) => i !== 2);
  assert.match(checkGatewayLog(lines).join('\n'), /seq 3 at line 2/);
});

test('a second terminal disposition for one call is a problem', () => {
  const executed = typed('executed');
  const lines = renumber([...logs.gateway, { ...clone(executed) }]);
  assert.match(checkGatewayLog(lines).join('\n'), new RegExp(`${executed.call_id}: 2 terminal dispositions`));
});

test('an execution after a deny is a problem', () => {
  const denied = typed('denied');
  const lines = renumber([...logs.gateway, { ...clone(typed('executed')), call_id: denied.call_id }]);
  assert.match(checkGatewayLog(lines).join('\n'), /executed after a deny/);
});

test('harm with no execution, connection loss or settle is a problem', () => {
  const lines = renumber([...logs.gateway, { type: 'harm', runId: logs.gateway[0].runId, rules: ['R2'], cause: typed('denied').call_id }]);
  assert.match(checkGatewayLog(lines).join('\n'), /has no execution/);
});

test('an approval update with no record is a problem', () => {
  const lines = renumber([...logs.gateway, { type: 'approval_update', approval_id: 'a9', status: 'granted', consumed_by: null }]);
  assert.match(checkGatewayLog(lines).join('\n'), /names no record \(a9\)/);
});

test('an approval consumed by two calls is a problem', () => {
  const request = { type: 'approval_request', approval_id: 'a1', action: 'open_guard', call_id: 'c1', answer: 'granted' };
  const use = (by) => ({ type: 'approval_update', approval_id: 'a1', status: 'granted', consumed_by: by });
  const lines = renumber([...logs.gateway, request, use('c5'), use('c7')]);
  assert.match(checkGatewayLog(lines).join('\n'), /a1 consumed twice/);
});

test('a call after the settle is a problem', () => {
  const lines = renumber([...logs.gateway, clone(typed('call'))]);
  assert.match(checkGatewayLog(lines).join('\n'), /after the settle/);
});

test('a test-mode log is never valid', () => {
  const lines = clone(logs.gateway);
  lines[0].testMode = true;
  assert.match(checkGatewayLog(lines).join('\n'), /testMode/);
});

test('an execution with no world line is a cross-log problem', () => {
  const executed = typed('executed');
  const world = renumber(logs.world.filter((w) => w.cause !== executed.call_id));
  assert.match(checkCrossLog(logs.gateway, world).join('\n'), new RegExp(`no world line for ${executed.call_id}`));
});

test('a world state that differs from executed.state_after is a cross-log problem', () => {
  const executed = typed('executed');
  const world = clone(logs.world);
  world.find((w) => w.cause === executed.call_id).state.speed_mmps += 1;
  assert.match(checkCrossLog(logs.gateway, world).join('\n'), /differs from executed.state_after/);
});

test('a world line naming an unknown call is a cross-log problem', () => {
  const world = renumber([...logs.world, { ...clone(logs.world[1]), cause: 'c999' }]);
  assert.match(checkCrossLog(logs.gateway, world).join('\n'), /names c999/);
});

test('two runIds across the logs is a cross-log problem', () => {
  const world = clone(logs.world);
  world[0].runId = 'f'.repeat(32);
  assert.match(checkCrossLog(logs.gateway, world).join('\n'), /2 runIds/);
});

test('a run with a fault at the start and a dropped link passes every log rule and cross-log rule', async () => {
  const faults = [{ which: 'jam', atCall: 0 }, { which: 'drop_link', atCall: 1, then: { person_in_zone: true } }];
  const run = await realLogs({ ...MOVING, faults }, [[INIT, call(1, 'set_speed', { speed_mmps: 300 })], [INIT, call(1, 'estop')]]);
  assert.deepEqual(run.gateway.filter((l) => l.type === 'fault').map((l) => l.which), ['jam', 'drop_link']);
  assert.ok(run.gateway.some((l) => l.type === 'connection_lost'));
  assert.deepEqual(checkGatewayLog(run.gateway), []);
  assert.deepEqual(checkCrossLog(run.gateway, run.world), []);
});
