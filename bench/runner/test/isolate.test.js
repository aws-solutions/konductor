// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const net = require('node:net');
const { makeIsolation, probeUnshare, resolveIsolation, writableTrees, runtimeSockets, realHomes } = require('../lib/isolate.js');
const { createTripwire, tripwireFlags, REPO_EXCLUDES } = require('../lib/tripwire.js');
const { makeScratchRoot } = require('../lib/sandbox.js');

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

function inNs(scratch, script, opts = {}) {
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, ...opts });
  const w = iso.wrap('sh', ['-c', script]);
  return spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
}

test('mode none passes the command through unchanged', () => {
  const iso = makeIsolation({ mode: 'none', scratchRoot: '/x' });
  assert.deepEqual(iso.wrap('a', ['b']), { file: 'a', args: ['b'] });
});

test('--isolate unshare and auto both abort when the probe fails; none always works', () => {
  const failing = () => ({ ok: false, reason: 'no user namespaces' });
  assert.throws(() => resolveIsolation('unshare', undefined, failing), /not usable.*no user namespaces/);
  assert.throws(() => resolveIsolation('auto', undefined, failing), /unavailable.*--isolate none/);
  assert.equal(resolveIsolation('none', undefined, failing).mode, 'none');
});

test('auto picks the namespace when it works; none is always honoured', { skip }, () => {
  assert.equal(resolveIsolation('auto').mode, 'unshare');
  assert.equal(resolveIsolation('none').mode, 'none');
});

test('inside the namespace the scratch root is writable and the real home and /tmp are not', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const home = os.homedir();
    const r = inNs(scratch, [
      `touch ${scratch}/ok || exit 10`,
      `touch ${home}/.bench-should-fail 2>/dev/null && exit 11`,
      `touch ${os.tmpdir()}/.bench-should-fail 2>/dev/null && exit 12`,
      'exit 0',
    ].join('; '));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(scratch, 'ok')), true);
    assert.equal(fs.existsSync(path.join(home, '.bench-should-fail')), false);
    assert.equal(fs.existsSync(path.join(os.tmpdir(), '.bench-should-fail')), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('credential directories are hidden and the kiro auth database is masked', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const home = fs.realpathSync(os.homedir());
    const db = path.join(home, '.local/share/kiro-cli/data.sqlite3');
    const script = [
      ...['.aws', '.ssh', '.gnupg'].map((d) => `if [ -d ${home}/${d} ] && [ -n "$(ls -A ${home}/${d} 2>/dev/null)" ]; then exit 20; fi`),
      fs.existsSync(db) ? `if [ -s ${db} ]; then exit 21; fi` : 'true',
      'exit 0',
    ].join('; ');
    const r = inNs(scratch, script);
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the agent has no capabilities and cannot remount or unmount', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const r = inNs(scratch, [
      `grep -q '^CapEff:[[:space:]]*0000000000000000$' /proc/self/status || exit 30`,
      `grep -q '^NoNewPrivs:[[:space:]]*1$' /proc/self/status || exit 31`,
      `mount -o remount,rw ${os.tmpdir()} 2>/dev/null && exit 32`,
      `umount ${scratch} 2>/dev/null && exit 33`,
      'exit 0',
    ].join('; '));
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--hide masks files with /dev/null and directories with an empty tmpfs', { skip }, () => {
  const scratch = makeScratchRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-home-'));
  try {
    fs.writeFileSync(path.join(home, '.token'), 'SECRET');
    fs.writeFileSync(path.join(home, '.bash_history'), 'SECRET');
    fs.mkdirSync(path.join(home, '.cookies'));
    fs.writeFileSync(path.join(home, '.cookies/jar'), 'SECRET');
    fs.writeFileSync(path.join(home, 'visible'), 'ok');
    const r = inNs(scratch, [
      `[ ! -s ${home}/.token ] || exit 40`,
      `[ ! -s ${home}/.bash_history ] || exit 41`,
      `[ -z "$(ls -A ${home}/.cookies)" ] || exit 42`,
      `[ "$(cat ${home}/visible)" = ok ] || exit 43`,
      'exit 0',
    ].join('; '), { home, hide: ['.token', '.cookies'] });
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.token'), 'utf8'), 'SECRET');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('container runtime sockets and ssh agent dirs are masked', { skip }, async () => {
  const scratch = makeScratchRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sock-'));
  const sock = path.join(dir, 'docker-test.sock');
  const other = path.join(dir, 'plain.sock');
  const sshDir = path.join(dir, 'ssh-AAAA');
  fs.mkdirSync(sshDir);
  fs.writeFileSync(path.join(sshDir, 'agent.1'), 'x');
  const servers = [sock, other].map((p) => net.createServer().listen(p));
  await Promise.all(servers.map((s) => new Promise((r) => s.on('listening', r))));
  try {
    assert.deepEqual(runtimeSockets([dir]).map((p) => path.basename(p)), ['docker-test.sock']);
    const r = inNs(scratch, [
      `[ ! -S ${sock} ] || exit 50`,
      `[ -S ${other} ] || exit 51`,
      `[ -z "$(ls -A ${sshDir})" ] || exit 52`,
      'exit 0',
    ].join('; '), { socketDirs: [dir], sshTmp: dir });
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.equal(fs.existsSync(path.join(sshDir, 'agent.1')), true);
  } finally {
    servers.forEach((s) => s.close());
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mask hides bench fixtures, reference solutions and every answer key', { skip }, () => {
  const scratch = makeScratchRoot();
  const bench = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  try {
    fs.mkdirSync(path.join(bench, 'fixtures/fx'), { recursive: true });
    fs.mkdirSync(path.join(bench, 'tasks/solutions/t1'), { recursive: true });
    fs.mkdirSync(path.join(bench, 'elsewhere'), { recursive: true });
    fs.writeFileSync(path.join(bench, 'fixtures/fx/.bench-answer-key.md'), 'KEY');
    fs.writeFileSync(path.join(bench, 'tasks/solutions/t1/report.md'), 'SOLUTION');
    fs.writeFileSync(path.join(bench, 'elsewhere/.bench-answer-key.md'), 'KEY');
    fs.writeFileSync(path.join(bench, 'elsewhere/keep.txt'), 'visible');
    const r = inNs(scratch, [
      `[ -z "$(ls -A ${bench}/fixtures)" ] || exit 60`,
      `[ -z "$(ls -A ${bench}/tasks/solutions)" ] || exit 61`,
      `[ ! -s ${bench}/elsewhere/.bench-answer-key.md ] || exit 62`,
      `[ "$(cat ${bench}/elsewhere/keep.txt)" = visible ] || exit 63`,
      'exit 0',
    ].join('; '), { mask: [path.join(bench, 'fixtures'), path.join(bench, 'tasks/solutions')], keyRoots: [bench] });
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(bench, { recursive: true, force: true });
  }
});

test('user-writable trees outside the home cannot be changed from the namespace', { skip }, () => {
  const scratch = makeScratchRoot();
  const trees = writableTrees().filter((t) => !fs.realpathSync(t).startsWith(os.homedir()) && !scratch.startsWith(fs.realpathSync(t)));
  const name = `.bench-probe-${process.pid}`;
  try {
    const r = inNs(scratch, trees.map((t) => `touch ${t}/${name} 2>/dev/null; true`).join('; ') || 'true');
    assert.equal(r.status, 0, r.stderr);
    for (const t of trees) assert.equal(fs.existsSync(path.join(t, name)), false, t);
  } finally {
    for (const t of trees) fs.rmSync(path.join(t, name), { force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a setsid grandchild dies with the namespace', { skip }, () => {
  const scratch = makeScratchRoot();
  const secs = `61.${process.pid}`;
  const left = () => spawnSync('pgrep', ['-f', `sleep ${secs.replace('.', '[.]')}`], { encoding: 'utf8' }).stdout.trim();
  try {
    const r = inNs(scratch, `setsid sleep ${secs} & sleep 0.3`);
    assert.equal(r.status, 0, r.stderr);
    for (let i = 0; i < 20 && left(); i++) spawnSync('sleep', ['0.1']);
    assert.equal(left(), '');
  } finally {
    for (const pid of left().split('\n').filter(Boolean)) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('tripwire reports entries changed after the marker and respects excludes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-'));
  try {
    fs.mkdirSync(path.join(root, 'watch/deep/er/still'), { recursive: true });
    fs.mkdirSync(path.join(root, 'watch/skip'), { recursive: true });
    fs.mkdirSync(path.join(root, 'watch/pkg/node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'watch/old.txt'), 'x');
    const t = createTripwire({
      markerPath: path.join(root, 'marker/m'),
      roots: [{ dir: path.join(root, 'watch'), depth: 3, exclude: ['skip', ...REPO_EXCLUDES] }],
      absExclude: [path.join(root, 'watch/ignored-abs')],
    });
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(root, 'watch/old.txt'), past, past);
    for (const d of ['watch', 'watch/deep', 'watch/deep/er', 'watch/skip', 'watch/pkg', 'watch/pkg/node_modules']) fs.utimesSync(path.join(root, d), past, past);
    t.start();
    assert.deepEqual(t.check().hits, []);
    spawnSync('sleep', ['0.05']);
    fs.writeFileSync(path.join(root, 'watch/new.txt'), 'y');
    fs.writeFileSync(path.join(root, 'watch/skip/new.txt'), 'y');
    fs.writeFileSync(path.join(root, 'watch/pkg/node_modules/new.txt'), 'y');
    const res = t.check();
    assert.ok(res.hits.includes(path.join(root, 'watch/new.txt')));
    assert.equal(res.hits.some((h) => h.includes('/skip')), false);
    assert.equal(res.hits.some((h) => h.includes('node_modules')), false);
    assert.equal(res.truncated, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tripwire does not flag a directory only because an excluded child changed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-'));
  try {
    fs.mkdirSync(path.join(root, 'w/data/run'), { recursive: true });
    const t = createTripwire({ markerPath: path.join(root, 'm'), roots: [{ dir: path.join(root, 'w'), depth: 3, exclude: ['data/run'] }] });
    t.start();
    spawnSync('sleep', ['0.05']);
    fs.writeFileSync(path.join(root, 'w/data/run/churn'), 'x');
    assert.deepEqual(t.check().hits, []);
    fs.writeFileSync(path.join(root, 'w/data/real.txt'), 'x');
    assert.deepEqual(t.check().hits, [path.join(root, 'w/data/real.txt')]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tripwire hits are flags without the namespace and informational inside it', () => {
  const hit = { hits: ['/home/u/x'], total: 1, truncated: true };
  assert.deepEqual(tripwireFlags(hit, 'none'), ['homeTripwire', 'homeTripwireTruncated']);
  assert.deepEqual(tripwireFlags(hit, 'unshare'), []);
  assert.deepEqual(tripwireFlags({ hits: [], total: 0, truncated: false }, 'none'), []);
  const lib = path.join(os.tmpdir(), 'h', 'Library');
  const flagged = [path.join(lib, 'LaunchAgents'), path.join(lib, 'Services')];
  const trip = (hits) => ({ hits: hits.slice(0, 50), allHits: hits, total: hits.length, truncated: false });
  const churn = Array.from({ length: 60 }, (_, i) => path.join(lib, 'Preferences', `p${i}.plist`));
  assert.deepEqual(tripwireFlags(trip(churn), 'sandbox-exec', flagged), [], 'system churn under ~/Library is not flagged');
  const agent = trip([...churn, path.join(lib, 'LaunchAgents', 'x.plist')]);
  assert.deepEqual(tripwireFlags(agent, 'sandbox-exec', flagged), ['homeTripwire'], 'an autorun dir hit past the first 50 is flagged');
  assert.deepEqual(tripwireFlags(trip([path.join(os.tmpdir(), 'h', '.zshrc')]), 'sandbox-exec', flagged), []);
  assert.deepEqual(tripwireFlags(agent, 'unshare', flagged), []);
});

test('realHomes finds the account home from the password database even when HOME points at a scratch directory', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-'));
  try {
    const homes = realHomes(scratch);
    assert.ok(homes.includes(fs.realpathSync(scratch)));
    assert.ok(homes.includes(fs.realpathSync(os.userInfo().homedir)));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
