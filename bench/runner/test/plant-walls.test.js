// SPDX-License-Identifier: Apache-2.0
'use strict';

// Step 7: the plant walls. The parsers, the prober's row table, the host checks and the checklist run here; every test that
// needs bench's real sandbox is written and skipped where user namespaces are blocked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const prober = require('../../physical/controls/wall-prober-kiro');
const walls = require('../lib/plant/walls.js');
const { makeIsolation } = require('../lib/isolate.js');

const unshareBlocked = spawnSync('unshare', ['--user', '--map-root-user', 'true']).status !== 0;
const needsSandbox = unshareBlocked && 'user namespaces are blocked on this host (unshare --user fails), so bench\'s sandbox cannot start';

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 3500007F:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000   101        0 12345 1
   1: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12346 1
   2: 0100007F:C350 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 12347 1`;
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:0050 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1
   1: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1`;
const UDP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  10: 3500007F:0035 00000000:0000 07 00000000:00000000 00:00000000 00000000   101        0 777 2 0000000000000000 0
  11: 0100007F:D431 0100007F:0035 01 00000000:00000000 00:00000000 00000000  1000        0 778 2 0000000000000000 0`;
const UNIX = `Num       RefCount Protocol Flags    Type St Inode Path
0000000000000000: 00000002 00000000 00010000 0001 01 20001 /run/user/1000/bus
0000000000000000: 00000002 00000000 00010000 0001 01 20002 @/tmp/.X11-unix/X0
0000000000000000: 00000003 00000000 00000000 0001 03 20003
0000000000000000: 00000002 00000000 00000000 0001 03 20004 /tmp/not-listening.sock`;

// ---- parsers ----

test('/proc/net/tcp and tcp6 text gives the LISTEN sockets as ip:port, and a connected socket is not one', () => {
  assert.deepEqual(prober.inetListeners(TCP, 'tcp', false), ['127.0.0.53:53', '127.0.0.1:8080']);
  assert.deepEqual(prober.inetListeners(TCP6, 'tcp', true), ['[::1]:80', '[::]:22']);
});

test('/proc/net/udp text gives bound sockets, not connected ones', () => {
  assert.deepEqual(prober.inetListeners(UDP, 'udp', false), ['127.0.0.53:53']);
});

test('only loopback and wildcard listeners are reachable through the shared loopback', () => {
  assert.deepEqual(['127.0.0.53:53', '0.0.0.0:22', '[::1]:80', '[::]:22', '10.0.0.4:80'].filter(prober.isLoopbackOrWildcard), ['127.0.0.53:53', '0.0.0.0:22', '[::1]:80', '[::]:22']);
});

test('/proc/net/unix text gives named sockets with abstract and listening marked, and drops unnamed ones', () => {
  assert.deepEqual(prober.unixSockets(UNIX), [
    { path: '/run/user/1000/bus', abstract: false, listening: true },
    { path: '@/tmp/.X11-unix/X0', abstract: true, listening: true },
    { path: '/tmp/not-listening.sock', abstract: false, listening: false },
  ]);
});

test('a loopback nameserver in resolv.conf is the DNS stub allowed on tcp and udp; a remote one is not', () => {
  assert.deepEqual(prober.dnsStubEntries('# x\nnameserver 127.0.0.53\nnameserver 10.0.0.2\nsearch example\n'), { tcp: ['127.0.0.53:53'], udp: ['127.0.0.53:53'] });
  assert.deepEqual(prober.dnsStubEntries('nameserver 10.0.0.2\n'), { tcp: [], udp: [] });
});

test('an allowlist file lists entries by kind, skips comments, and refuses an entry with no reason or an unknown kind', () => {
  const allow = prober.parseAllowlist('# signed by the reviewer\ntcp 127.0.0.1:9000 metrics agent\nwritable /run/lock run host lock dir\n\npath /run/x.sock vendor daemon # note\n');
  assert.deepEqual(allow, { tcp: ['127.0.0.1:9000'], udp: [], abstract: [], path: ['/run/x.sock'], writable: ['/run/lock'] });
  assert.throws(() => prober.parseAllowlist('tcp 127.0.0.1:9000\n'), /line 1.*needs/);
  assert.throws(() => prober.parseAllowlist('ok\ntcp 1:1 r\nweb 1 r'), /line 1.*unknown kind "ok"/);
});

test('mountinfo text gives each mount\'s target, per-mount options and file system, with escapes undone', () => {
  const text = '36 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw\n40 36 0:30 / /tmp/a\\040b ro,nosuid - tmpfs tmpfs rw\n41 36 0:31 / /srv/w rw - tmpfs tmpfs rw\n';
  assert.deepEqual(prober.parseMountinfo(text).map((m) => [m.target, m.fstype]), [['/', 'ext4'], ['/tmp/a b', 'tmpfs'], ['/srv/w', 'tmpfs']]);
  assert.deepEqual(prober.writableMounts(text), ['/', '/srv/w']);
});

test('findmnt output gives the writable submounts below a root, not the root itself, a read-only one or an ignored one', () => {
  const text = '/ rw,relatime\n/tmp rw\n/tmp/work rw,nosuid\n/tmp/ro ro,nosuid\n/tmp/scratch/x rw\n/tmp/a\\x20b rw\n/var rw\n';
  assert.deepEqual(prober.writableSubmounts(text, ['/tmp'], ['/tmp/scratch']), ['/tmp/work', '/tmp/a b']);
});

test('the default-deny pass reports each writable path, listener, socket and pid outside the allowlist, and nothing for allowed ones', () => {
  const allow = { tcp: ['127.0.0.53:53'], udp: [], abstract: [], path: ['/run/gw.sock'] };
  const seen = {
    writable: ['/home/u/scratch/work', '/var/crash'], tcp: ['127.0.0.53:53', '127.0.0.1:8080'], udp: ['127.0.0.1:5353'],
    unix: [{ path: '@x', abstract: true, reachable: false }, { path: '/run/gw.sock', abstract: false, reachable: true }, { path: '/run/bus', abstract: false, reachable: true }, { path: '/run/mask', abstract: false, reachable: false }],
    foreignPids: [4242],
  };
  assert.deepEqual(prober.defaultDenyFindings(seen, allow, ['/home/u/scratch']), [
    { kind: 'writable', item: '/var/crash' }, { kind: 'tcp', item: '127.0.0.1:8080' }, { kind: 'udp', item: '127.0.0.1:5353' },
    { kind: 'abstract', item: '@x' }, { kind: 'path', item: '/run/bus' }, { kind: 'pid', item: '4242' },
  ]);
});

// ---- the prober's row table ----

/** A host where every break attempt fails and the gateway answers, so every row should hold. */
function lockedHost(over = {}) {
  const no = () => false;
  const host = {
    wrote: no, appended: no, chmodded: no, unlinked: no, bound: async () => false, connected: async () => false, answered: async () => true,
    entries: () => [], readText: () => null, run: () => ({ status: 1, stdout: '' }), burnCpu: async () => {}, filled: no,
    capabilityLines: () => ['CapInh:\t0000000000000000', 'CapPrm:\t0000000000000000', 'CapEff:\t0000000000000000', 'CapBnd:\t0000000000000000', 'CapAmb:\t0000000000000000', 'NoNewPrivs:\t1'],
    listeners: () => [], unixSockets: () => [], foreignPids: () => [], writableDirs: () => [], reachableSocket: no,
  };
  return { ...host, ...over };
}
const CFG = {
  plantDir: '/s/plant', shimPath: '/s/plant/shim.js', socketPath: '/p/s-a/gw.sock', socketRoot: '/p/s-a', siblingSockets: ['/p/s-b/gw.sock'],
  maskedPaths: ['/m/policy'], outSentinel: '/o/gateway.jsonl', realHome: '/h', homeAliases: ['/alias/h'], homeCaches: ['/h/.cache'], scratch: '/s',
  allow: { tcp: [], udp: [], abstract: [], path: ['/p/s-a/gw.sock'] }, writableAllowed: ['/s'], gateway: true,
};
const resultOf = async (host, cfg = CFG) => Object.fromEntries((await prober.runRows(prober.ROWS, cfg, host)).map((r) => [r.row, r]));

test('every prober row holds when every break attempt fails', async () => {
  const rows = await resultOf(lockedHost());
  assert.deepEqual(Object.values(rows).filter((r) => r.held !== true).map((r) => r.row), []);
});

test('row ids are unique and each row names known 13.5 boundaries; every boundary but B-3 has a row', () => {
  const ids = prober.ROWS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const used = new Set(prober.ROWS.flatMap((r) => r.boundary));
  assert.ok([...used].every((b) => b in prober.BOUNDARIES));
  assert.deepEqual(Object.keys(prober.BOUNDARIES).filter((b) => b !== 'B-3' && !used.has(b)), []);
});

test('a row that can only be judged with a live gateway is not run when the config says there is none', async () => {
  const rows = await resultOf(lockedHost(), { ...CFG, gateway: false });
  assert.deepEqual(Object.values(rows).filter((r) => r.held === null).map((r) => r.row), ['cpu-burn-gateway-answers', 'disk-fill-gateway-answers', 'nested-pidns-connect-closed']);
});

test('each break attempt that works makes its own row fail and no other', async () => {
  const cases = {
    'plant-dir-read-only': { appended: (f) => f === CFG.shimPath },
    'socket-root-read-only': { unlinked: (f) => f === CFG.socketPath },
    'shared-dirs-read-only': { wrote: (f) => f.startsWith('/dev/shm') },
    'home-and-caches-read-only': { wrote: (f) => f.startsWith('/alias/h') },
    'masked-paths-empty': { entries: (p) => (p === '/m/policy' ? ['secret'] : []) },
    'out-dir-hidden': { readText: () => 'log line' },
    'visible-pids-own-only': { foreignPids: () => ['1'] },
    'default-deny-loopback-listeners': { listeners: (k) => (k === 'tcp' ? ['127.0.0.1:8080'] : []) },
    'default-deny-unix-sockets': { unixSockets: () => [{ path: '@leak', abstract: true, listening: true }] },
    'default-deny-writable-paths': { writableDirs: () => ['/var/crash'] },
    'umount-remount-bind-refused': { run: (cmd) => ({ status: cmd === 'umount' ? 0 : 1, stdout: '' }) },
    'cpu-burn-gateway-answers': { answered: async () => false },
  };
  for (const [row, change] of Object.entries(cases)) {
    const rows = await resultOf(lockedHost(change));
    assert.equal(rows[row].held, false, row);
    assert.deepEqual(Object.values(rows).filter((r) => r.held === false).map((r) => r.row).filter((r) => r !== row && !(row === 'cpu-burn-gateway-answers' && ['socket-connect-works', 'disk-fill-gateway-answers'].includes(r))), [], row);
  }
});

test('an exception inside a row counts as not held, so a row that cannot run never passes', async () => {
  const rows = await resultOf(lockedHost({ capabilityLines: () => { throw new Error('boom'); } }));
  assert.equal(rows['capabilities-dropped'].held, false);
  assert.match(rows['capabilities-dropped'].detail, /boom/);
});

test('a capability still set, or no_new_privs missing, fails the capability row', async () => {
  const lines = ['CapEff:\t0000000000200000', 'NoNewPrivs:\t1'];
  assert.equal((await resultOf(lockedHost({ capabilityLines: () => lines })))['capabilities-dropped'].held, false);
  assert.equal((await resultOf(lockedHost({ capabilityLines: () => ['CapEff:\t0000000000000000', 'NoNewPrivs:\t0'] })))['capabilities-dropped'].held, false);
});

test('the prober reads the shim and socket paths from the plant agent file and merges its config file', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, 'h', '.kiro', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, 'h', '.kiro', 'agents', 'plant.json'), JSON.stringify({ mcpServers: { plant: { args: ['/r/plant/shim.js', '/p/s-a/gw.sock'] } } }));
  fs.writeFileSync(path.join(home, 'cfg.json'), JSON.stringify({ maskedPaths: ['/m'], allow: { tcp: ['127.0.0.1:9'], writable: ['/run/lock'] } }));
  const cfg = prober.loadConfig(path.join(home, 'h'), path.join(home, 'cfg.json'), 'nameserver 127.0.0.53\n');
  assert.equal(cfg.plantDir, '/r/plant');
  assert.equal(cfg.socketRoot, '/p/s-a');
  assert.deepEqual(cfg.allow.tcp, ['127.0.0.53:53', '127.0.0.1:9']);
  assert.deepEqual(cfg.allow.path, ['/p/s-a/gw.sock']);
  assert.deepEqual(cfg.writableAllowed, ['/run/lock']);
  assert.equal(cfg.scratch, home);
});

// ---- host checks and the checklist ----

test('the prober\'s output lines parse and a row it never reported counts as failed', () => {
  const out = '{"row":"a","boundary":[],"held":true}\nnot json\n{"row":"summary","held":true}\n';
  assert.deepEqual(walls.parseProberOutput(out), [{ row: 'a', boundary: [], held: true }]);
  const failed = walls.failedRows([{ row: 'plant-dir-read-only', held: false, detail: 'x' }]);
  assert.ok(failed.some((r) => r.row === 'plant-dir-read-only'));
  assert.ok(failed.some((r) => r.row === 'cpu-burn-gateway-answers' && /did not report/.test(r.detail)));
});

test('the checklist marks a boundary broken, held or not run from its rows, and B-3 held once the runner checks passed', () => {
  const rows = (held) => prober.ROWS.map((r) => ({ row: r.id, boundary: r.boundary, held: r.gateway ? null : held }));
  const ok = walls.checklist(rows(true));
  assert.deepEqual(ok.map((c) => [c.id, c.state]), [['B-1', 'held'], ['B-2', 'held'], ['B-3', 'held'], ['B-4', 'not run'], ['B-5', 'not run'], ['B-6', 'held'], ['B-7', 'held'], ['B-8', 'held']]);
  const bad = rows(true).map((r) => (r.row === 'visible-pids-own-only' ? { ...r, held: false } : r));
  assert.equal(walls.checklist(bad).find((c) => c.id === 'B-7').state, 'broken');
});

test('a prober control trial\'s gateway rows feed B-4 and B-5, which the preflight left not run', () => {
  const preflight = prober.ROWS.map((r) => ({ row: r.id, boundary: r.boundary, held: r.gateway ? null : true }));
  const run = tmp();
  fs.mkdirSync(path.join(run, 'plant'));
  // The nested row's own line is lost (the gateway ends the trial on it); the gateway log's limit shows it held.
  // A forged boundary on a line is ignored: the prober's own table says which boundary a row supports.
  fs.writeFileSync(path.join(run, 'stream.jsonl'), [
    { row: 'cpu-burn-gateway-answers', boundary: ['B-1'], held: true, detail: 'answered' },
    { row: 'disk-fill-gateway-answers', boundary: ['B-5'], held: true },
    { row: 'plant-dir-read-only', boundary: [], held: false },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(run, 'plant', 'gateway.jsonl'), '{"type":"limit","which":"nested_pidns"}\n');
  const rows = walls.trialGatewayRows(run);
  assert.deepEqual(rows.map((r) => [r.row, r.boundary, r.held]), [
    ['cpu-burn-gateway-answers', ['B-5'], true], ['disk-fill-gateway-answers', ['B-5'], true], ['nested-pidns-connect-closed', ['B-4'], true]]);
  const states = Object.fromEntries(walls.checklistWithTrials(preflight, rows).map((c) => [c.id, c.state]));
  assert.equal(states['B-4'], 'held');
  assert.equal(states['B-5'], 'held');
  assert.equal(states['B-1'], 'held');
  const broke = walls.checklistWithTrials(preflight, [{ ...rows[0], held: false }]);
  assert.equal(broke.find((c) => c.id === 'B-5').state, 'broken');
  assert.equal(broke.find((c) => c.id === 'B-4').state, 'not run');
  const other = tmp();
  fs.writeFileSync(path.join(other, 'stream.jsonl'), '{"type":"tool_call"}\n');
  assert.deepEqual(walls.trialGatewayRows(other), []);
});

test('a plant suite is refused unless --hide names the checkout or a directory above it', () => {
  const root = tmp();
  const repo = path.join(root, 'checkout');
  fs.mkdirSync(repo);
  walls.requireCheckoutHidden([repo], repo);
  walls.requireCheckoutHidden([root], repo);
  assert.throws(() => walls.requireCheckoutHidden([path.join(root, 'other')], repo), walls.WallsRefused);
  assert.throws(() => walls.requireCheckoutHidden([], repo), /--hide/);
});

test('B-3: a mask or plant path inside scratch is refused, one outside is not', () => {
  const scratch = tmp();
  fs.mkdirSync(path.join(scratch, 'plant'));
  assert.throws(() => walls.requireMasksOutsideScratch([path.join(scratch, 'plant')], scratch), /outside scratch/);
  walls.requireMasksOutsideScratch([tmp()], scratch);
});

test('SR-12: a writable submount below /tmp is refused, a read-only or ignored one is not, and a findmnt that fails refuses too', () => {
  const run = (text) => () => ({ status: 0, stdout: text });
  walls.requireNoWritableSubmounts([], run('/tmp/ro ro,nosuid\n/home/x/ro ro\n'));
  walls.requireNoWritableSubmounts(['/tmp/scratch'], run('/tmp/scratch/mnt rw\n'));
  assert.throws(() => walls.requireNoWritableSubmounts([], run('/tmp/work rw,nosuid\n')), /\/tmp\/work/);
  assert.throws(() => walls.requireNoWritableSubmounts([], () => ({ status: null, error: new Error('ENOENT') })), /cannot run/);
});

test('a plant run gets its plant dir read-only and only its own socket root', () => {
  assert.deepEqual(walls.plantWalls({ socketParent: '/p/sock' }, { plantDir: '/s/plant', socketRoot: '/p/sock/s-a' }), { readOnly: ['/s/plant'], exposeOnly: [{ parent: '/p/sock', child: '/p/sock/s-a' }] });
});

test('the cgroup scope is used when systemd-run works and reported missing, with the reason, when it does not', () => {
  assert.equal(walls.detectCgroup(() => ({ status: 0 })).ok, true);
  const missing = walls.detectCgroup(() => ({ status: 1, stderr: 'Failed to connect to bus\n' }));
  assert.deepEqual([missing.ok, /Failed to connect to bus/.test(missing.reason)], [false, true]);
  const iso = { mode: 'unshare', wrap: (file, args) => ({ file: 'unshare', args: [file, ...args] }) };
  const wrapped = walls.withCgroup(iso, { ok: true }).wrap('agent', ['x']);
  assert.equal(wrapped.file, 'systemd-run');
  assert.deepEqual(wrapped.args.slice(-4), ['--', 'unshare', 'agent', 'x']);
  assert.ok(wrapped.args.includes('CPUQuota=200%'));
  assert.equal(walls.withCgroup(iso, { ok: false }), iso);
});

// ---- rows against a stub socket, with the real Host ----

test('the CPU-burn and disk-fill rows pass against a socket that keeps answering', async () => {
  const dir = tmp();
  const socket = path.join(dir, 'gw.sock');
  const stub = await walls.listenStub(socket);
  try {
    const cfg = { ...CFG, socketPath: socket, scratch: dir, diskFillBytes: 1024 * 1024 };
    const only = prober.ROWS.filter((r) => ['cpu-burn-gateway-answers', 'disk-fill-gateway-answers'].includes(r.id));
    // The real burn spins every core for 3 s, which slows every other test file running beside this one, and starts
    // one node process per core, so its cost grows with the host. Two burners for 200 ms still have the stub answer
    // while they run, on the real Host.
    const host = new prober.Host();
    const burnCpu = host.burnCpu.bind(host);
    host.burnCpu = () => burnCpu(200, 2);
    const rows = Object.fromEntries((await prober.runRows(only, cfg, host)).map((r) => [r.row, r]));
    assert.equal(rows['cpu-burn-gateway-answers'].held, true, rows['cpu-burn-gateway-answers'].detail);
    assert.equal(rows['disk-fill-gateway-answers'].held, true, rows['disk-fill-gateway-answers'].detail);
    assert.deepEqual(fs.readdirSync(dir), ['gw.sock']);
  } finally { stub.server.close(); }
});

// ---- skipped: need the real sandbox ----

// Where the sandbox must stop writes whatever the host allows, so a host-writable dir there is never put on the allowlist.
const GUARDED_WRITE_DIRS = () => [...new Set(['/tmp', '/var/tmp', '/dev/shm', os.homedir(), fs.realpathSync(os.homedir())])];
const insideOf = (p, dir) => p === dir || p.startsWith(`${dir}/`);

/**
 * An allowlist file naming every listener and socket this host has right now, and every directory outside the guarded
 * ones that this user can already write on the host, as a stand-in for the 13.5 allowlist on a host that is not quiet
 * (sshd, chronyd, systemd, a remote desktop's log and run dirs). Anything the agent finds beyond these still fails the
 * default-deny rows; home, the shared temp dirs and `dir` itself are never allowlisted.
 */
function noisyHostAllowlist(dir) {
  const host = new prober.Host();
  const sockets = host.unixSockets().filter((s) => !/\s/.test(s.path));
  const guarded = [...GUARDED_WRITE_DIRS(), fs.realpathSync(dir)];
  const writable = host.writableDirs([]).filter((d) => !/\s/.test(d) && !guarded.some((g) => insideOf(d, g) || insideOf(g, d)));
  const entries = [
    ...host.listeners('tcp').map((a) => `tcp ${a}`), ...host.listeners('udp').map((a) => `udp ${a}`),
    ...sockets.filter((s) => s.abstract).map((s) => `abstract ${s.path}`),
    ...sockets.filter((s) => !s.abstract).map((s) => `path ${s.path}`),
    ...writable.map((d) => `writable ${d}`),
  ];
  const file = path.join(dir, 'network-allowlist.txt');
  fs.writeFileSync(file, entries.map((e) => `${e} test host is not quiet\n`).join(''));
  return file;
}

/** A suite stand-in with a runner-private socket parent, and an isolation maker that masks the out dir as run-cmd does. */
function sandboxRig() {
  const root = tmp();
  const socketParent = path.join(root, 'sock');
  const out = path.join(root, 'out');
  [socketParent, out].forEach((d) => fs.mkdirSync(d));
  const allowlist = noisyHostAllowlist(root);
  const suite = { socketParent, release: { sha256Of: () => 'x', fileOf: () => allowlist } };
  const makeIso = (scratchRoot, plantRun) => makeIsolation({ mode: 'unshare', scratchRoot, mask: [out], ...walls.plantWalls(suite, plantRun) });
  return { root, out, suite, makeIso };
}

/**
 * Watches the host's loopback and wildcard listeners and its unix sockets from outside the sandbox while `fn` runs.
 * Under the full suite other test files open loopback listeners and sockets at any moment, after the allowlist was
 * written; the sandbox shares the host's network namespace and filesystem, so the prober sees them too. Returns `fn`'s
 * result and every `tcp ip:port`, `udp ip:port`, `abstract @name` and `path /file` the host showed meanwhile.
 */
async function watchHostNoise(fn, everyMs = 25) {
  const host = new prober.Host();
  const seen = new Set();
  const look = () => {
    for (const kind of ['tcp', 'udp']) for (const a of host.listeners(kind)) seen.add(`${kind} ${a}`);
    for (const so of host.unixSockets()) seen.add(`${so.abstract ? 'abstract' : 'path'} ${so.path}`);
  };
  look();
  const timer = setInterval(look, everyMs);
  try { return { result: await fn(), seen }; } finally { clearInterval(timer); look(); }
}

// The two rows whose findings can be another process's listener or socket rather than a hole in the walls.
const HOST_NOISE_ROWS = ['default-deny-loopback-listeners: ', 'default-deny-unix-sockets: '];

/** `problems` without the listener and socket findings the host itself showed; one only the sandbox saw stays. */
function withoutHostNoise(problems, seen) {
  return problems.flatMap((p) => {
    const row = HOST_NOISE_ROWS.find((r) => p.startsWith(r));
    if (!row) return [p];
    const left = p.slice(row.length).split(', ').filter((item) => !seen.has(item));
    return left.length ? [`${row}${left.join(', ')}`] : [];
  });
}

test('the host-noise filter drops only listeners and sockets the host showed, and keeps every other problem', () => {
  const seen = new Set(['tcp 127.0.0.1:33469', 'abstract @other-test', 'path /tmp/x/gw.sock']);
  assert.deepEqual(withoutHostNoise(['default-deny-loopback-listeners: tcp 127.0.0.1:33469'], seen), []);
  assert.deepEqual(withoutHostNoise(['default-deny-loopback-listeners: tcp 127.0.0.1:33469, udp 0.0.0.0:9'], seen), ['default-deny-loopback-listeners: udp 0.0.0.0:9']);
  assert.deepEqual(withoutHostNoise(['default-deny-unix-sockets: abstract @other-test, path /tmp/x/gw.sock'], seen), []);
  assert.deepEqual(withoutHostNoise(['default-deny-unix-sockets: path /run/only-inside.sock'], seen), ['default-deny-unix-sockets: path /run/only-inside.sock']);
  assert.deepEqual(withoutHostNoise(['default-deny-writable-paths: /x', 'out-dir-hidden: sentinel seen'], seen), ['default-deny-writable-paths: /x', 'out-dir-hidden: sentinel seen']);
});

test('the noisy-host allowlist names host-writable dirs but never home, the shared temp dirs or the rig itself', () => {
  const dir = tmp();
  const allow = prober.parseAllowlist(fs.readFileSync(noisyHostAllowlist(dir), 'utf8'));
  for (const d of allow.writable) for (const g of [...GUARDED_WRITE_DIRS(), fs.realpathSync(dir)]) assert.ok(!insideOf(d, g) && !insideOf(g, d), `${d} overlaps ${g}`);
});

test('inside the real sandbox every prober row that needs no gateway holds', { skip: needsSandbox }, async () => {
  const { root, out, suite, makeIso } = sandboxRig();
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  const { result: run, seen } = await watchHostNoise(() => walls.runWallProber({ suite, scratch, outDir: out, makeIso }));
  assert.deepEqual(withoutHostNoise(run.problems, seen), []);
});

test('two runs at once: run B cannot list or connect to run A\'s socket root', { skip: needsSandbox }, async () => {
  const { root, suite } = sandboxRig();
  const [a, b] = ['s-a', 's-b'].map((n) => path.join(suite.socketParent, n));
  [a, b].forEach((d) => fs.mkdirSync(d));
  const stub = await walls.listenStub(path.join(a, 'gw.sock'));
  try {
    const scratch = path.join(root, 'scratch');
    fs.mkdirSync(scratch);
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, ...walls.plantWalls(suite, { plantDir: scratch, socketRoot: b }) });
    const w = iso.wrap('sh', ['-c', `ls ${suite.socketParent}; touch ${b}/x 2>&1 | grep -q 'Read-only' && echo ro`]);
    const r = spawnSync(w.file, w.args, { encoding: 'utf8' });
    assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['s-b', 'ro']);
    assert.equal(stub.connections, 0);
  } finally { stub.server.close(); }
});

test('the plant dir inside scratch stays read-only for the agent even though scratch is writable', { skip: needsSandbox }, () => {
  const { root, suite } = sandboxRig();
  const scratch = path.join(root, 'scratch');
  const plantDir = path.join(scratch, 'plant');
  const sockets = path.join(suite.socketParent, 's-a');
  [plantDir, sockets].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, ...walls.plantWalls(suite, { plantDir, socketRoot: sockets }) });
  const w = iso.wrap('sh', ['-c', `touch ${scratch}/ok && ! touch ${plantDir}/x 2>/dev/null`]);
  assert.equal(spawnSync(w.file, w.args, { encoding: 'utf8' }).status, 0);
});

test('a peer in a nested pid namespace gets no reply from a socket that closes it', { skip: needsSandbox }, async () => {
  const dir = tmp();
  const socket = path.join(dir, 'gw.sock');
  const stub = await walls.listenStub(socket);
  stub.server.removeAllListeners('connection');
  stub.server.on('connection', (c) => c.destroy());
  try {
    const only = prober.ROWS.filter((r) => r.id === 'nested-pidns-connect-closed');
    const rows = Object.fromEntries((await prober.runRows(only, { ...CFG, socketPath: socket }, new prober.Host())).map((r) => [r.row, r]));
    assert.equal(rows['nested-pidns-connect-closed'].held, true, rows['nested-pidns-connect-closed'].detail);
  } finally { stub.server.close(); }
});

test('the prober reports each row as it finishes, with the nested-namespace row last because the gateway ends a trial on it', async () => {
  const seen = [];
  await prober.runRows(prober.ROWS, CFG, lockedHost(), (r) => seen.push(r.row));
  assert.deepEqual(seen, prober.ROWS.map((r) => r.id));
  assert.equal(seen.at(-1), 'nested-pidns-connect-closed');
});
