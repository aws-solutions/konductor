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
const { createTripwire, tripwireFlags, credentialPathNote, DEFAULT_EXCLUDES, REPO_EXCLUDES } = require('../lib/tripwire.js');
const { makeScratchRoot } = require('./scratch.js');
const { mkScratch } = require('./scratch.js');

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
  const home = mkScratch('hide-home-');
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
  const dir = mkScratch('sock-');
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
  const bench = mkScratch('bench-');
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
  const root = mkScratch('trip-');
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

test('the default home excludes cover the mise data directory and still report other changes under .local/share', () => {
  const root = mkScratch('trip-');
  try {
    fs.mkdirSync(path.join(root, 'home/.local/share/mise/installs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'home/.local/share/other'), { recursive: true });
    const t = createTripwire({ markerPath: path.join(root, 'm'), roots: [{ dir: path.join(root, 'home'), depth: 5, exclude: DEFAULT_EXCLUDES }] });
    t.start();
    spawnSync('sleep', ['0.05']);
    fs.writeFileSync(path.join(root, 'home/.local/share/mise/installs/tool'), 'x');
    assert.deepEqual(t.check().hits, []);
    fs.writeFileSync(path.join(root, 'home/.local/share/other/data'), 'x');
    const hits = t.check().hits;
    assert.ok(hits.includes(path.join(root, 'home/.local/share/other/data')));
    assert.equal(hits.some((h) => h.includes('/mise')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a tripwire hit on a credentials path carries a note that an external refresh may have caused it', () => {
  const root = mkScratch('trip-');
  try {
    fs.mkdirSync(path.join(root, 'home/.aws'), { recursive: true });
    const t = createTripwire({ markerPath: path.join(root, 'm'), roots: [{ dir: path.join(root, 'home'), depth: 3 }] });
    t.start();
    spawnSync('sleep', ['0.05']);
    fs.writeFileSync(path.join(root, 'home/notes.txt'), 'x');
    assert.equal(t.check().note, null);
    fs.writeFileSync(path.join(root, 'home/.aws/credentials'), 'x');
    const res = t.check();
    assert.match(res.note, /credentials path; it may come from an external refresh in another shell/);
    assert.equal(credentialPathNote([]), null);
    assert.equal(credentialPathNote(['/h/.claude/.credentials.json']) === null, false);
    assert.equal(credentialPathNote(['/h/credentials-notes.txt']), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tripwire does not flag a directory only because an excluded child changed', () => {
  const root = mkScratch('trip-');
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
  const cut = { ...trip(churn), truncated: true };
  assert.deepEqual(tripwireFlags(cut, 'sandbox-exec', flagged), ['homeTripwireTruncated'], 'a truncated walk is flagged');
  assert.deepEqual(tripwireFlags({ ...agent, truncated: true }, 'sandbox-exec', flagged), ['homeTripwire', 'homeTripwireTruncated']);
});

test('realHomes finds the account home from the password database even when HOME points at a scratch directory', () => {
  const scratch = mkScratch('rh-');
  try {
    const homes = realHomes(scratch);
    assert.ok(homes.includes(fs.realpathSync(scratch)));
    assert.ok(homes.includes(fs.realpathSync(os.userInfo().homedir)));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('an ssh-agent dir that vanishes or refuses the mount does not abort the isolation script', () => {
  const scratch = mkScratch('scr-');
  const tmp = mkScratch('sshtmp-');
  const gone = path.join(fs.realpathSync(tmp), 'ssh-GONE');
  const stuck = path.join(fs.realpathSync(tmp), 'ssh-STUCK');
  fs.mkdirSync(gone);
  fs.mkdirSync(stuck);
  try {
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, sshTmp: tmp });
    fs.rmSync(gone, { recursive: true });
    const lines = iso.script.split('\n').filter((l) => l.includes('ssh-'));
    assert.equal(lines.length, 2);
    const run = spawnSync('sh', ['-c', ['set -e', 'mount() { return 32; }', ...lines, 'echo reached'].join('\n')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /reached/);
    assert.match(run.stderr, /could not hide .*ssh-STUCK/);
    assert.doesNotMatch(run.stderr, /ssh-GONE/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readOnly and exposeOnly add their mounts after the scratch bind, and the script is valid shell', () => {
  const scratch = mkScratch('scr-');
  const parent = mkScratch('sock-');
  const own = path.join(parent, 's-a');
  const plant = path.join(scratch, 'plant');
  fs.mkdirSync(own);
  fs.mkdirSync(plant);
  const { script } = makeIsolation({ mode: 'unshare', scratchRoot: scratch, readOnly: [plant], exposeOnly: [{ parent, child: own }] });
  const lines = script.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  assert.ok(at(/^mount --bind .*remount,rw,bind/) < at(/^ro '.*plant'$/), 'plant dir goes read-only after scratch is made writable');
  assert.ok(at(/^ro '.*plant'$/) >= 0 && at(/^mount -t tmpfs tmpfs '.*sock-/) >= 0);
  assert.match(script, /mount -c --bind \/proc\/\$\$\/fd\/9 '.*s-a' && mount -o remount,ro,bind '.*s-a'/);
  assert.ok(at(/^mount -o remount,ro,bind '.*sock-[^']*'$/) > at(/s-a' && mount -o remount,ro,bind/), 'the emptied parent goes read-only after the child is back, so it holds no writable submount');
  assert.equal(spawnSync('sh', ['-n', '-c', script]).status, 0);
});

test('exposeOnly refuses a child that is not inside its parent', () => {
  const scratch = mkScratch('scr-');
  const [a, b] = [mkScratch('a-'), mkScratch('b-')];
  assert.throws(() => makeIsolation({ mode: 'unshare', scratchRoot: scratch, exposeOnly: [{ parent: a, child: b }] }), /not inside/);
  assert.throws(() => makeIsolation({ mode: 'unshare', scratchRoot: scratch, exposeOnly: [{ parent: a, child: a }] }), /not inside/);
});

test('without readOnly and exposeOnly the script has neither of their mounts', () => {
  const { script } = makeIsolation({ mode: 'unshare', scratchRoot: mkScratch('scr-') });
  assert.doesNotMatch(script, /exec 9</);
});

test('the isolation lists the masks that exist, for the wall prober', () => {
  const scratch = mkScratch('scr-', '/tmp');
  const home = mkScratch('home-', '/tmp');
  fs.mkdirSync(path.join(home, '.ssh'));
  const { masked } = makeIsolation({ mode: 'unshare', scratchRoot: scratch, home });
  assert.ok(masked.includes(path.join(fs.realpathSync(home), '.ssh')));
  assert.ok(!masked.includes(path.join(fs.realpathSync(home), '.aws')), 'a mask target that does not exist is not listed');
});

test('the host\'s POSIX message queue dir is masked when it exists, because the sandbox shares the IPC namespace', { skip: fs.existsSync('/dev/mqueue') ? false : '/dev/mqueue is absent on this host' }, () => {
  const { masked } = makeIsolation({ mode: 'unshare', scratchRoot: mkScratch('scr-') });
  assert.ok(masked.includes(fs.realpathSync('/dev/mqueue')));
});

test('inside the namespace the plant dir in scratch is read-only and only the exposed socket root shows', { skip: probe.ok ? false : skip }, () => {
  const scratch = mkScratch('scr-');
  const parent = mkScratch('sock-');
  const [a, b] = ['s-a', 's-b'].map((n) => path.join(parent, n));
  const plant = path.join(scratch, 'plant');
  [a, b, plant].forEach((d) => fs.mkdirSync(d));
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, readOnly: [plant], exposeOnly: [{ parent, child: b }] });
  const w = iso.wrap('sh', ['-c', `touch ${scratch}/ok || exit 10; touch ${plant}/x 2>/dev/null && exit 11; touch ${b}/x 2>/dev/null && exit 12; test "$(ls ${parent})" = s-b || exit 13`]);
  const r = spawnSync(w.file, w.args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('a writable dir outside scratch gets its own rw bind; a dir inside scratch adds nothing', () => {
  const scratch = mkScratch('scr-');
  const extra = mkScratch('scr-extra-');
  const { script } = makeIsolation({ mode: 'unshare', scratchRoot: scratch, writable: [extra, path.join(scratch, '.')] });
  const rw = script.split('\n').filter((l) => /remount,rw,bind/.test(l));
  assert.deepEqual(rw.map((l) => l.split(' ')[2]), [`'${fs.realpathSync(scratch)}'`, `'${fs.realpathSync(extra)}'`]);
  assert.equal(spawnSync('sh', ['-n', '-c', script]).status, 0);
});

test('inside the namespace a writable dir outside scratch takes writes and its sibling does not', { skip }, () => {
  const scratch = makeScratchRoot();
  const extra = `${scratch}-introspect`;
  const other = `${scratch}-other`;
  fs.mkdirSync(extra);
  fs.mkdirSync(other);
  try {
    const r = inNs(scratch, [`touch ${extra}/dump || exit 10`, `touch ${other}/x 2>/dev/null && exit 11`, 'exit 0'].join('; '), { writable: [extra] });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(extra, 'dump')), true);
    assert.equal(fs.existsSync(path.join(other, 'x')), false);
  } finally {
    for (const d of [scratch, extra, other]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// The mount plan, not a real namespace (it runs where unshare is refused): with TMPDIR=/tmp, a test dir under /tmp that
// is not the scratch root is read-only in the namespace, so a command cannot make files there (a stub that logs its calls
// beside its test dir failed this way in the full-suite run of 2026-11-27: the log dir, ENOENT from mkdir -p on a read-only mount).
for (const tmpdir of ['/tmp', undefined]) {
  test(`mount plan with TMPDIR=${tmpdir || 'unset'}: only the scratch root is writable under /tmp; a sibling test dir is read-only`, () => {
    const saved = process.env.TMPDIR;
    if (tmpdir) process.env.TMPDIR = tmpdir; else delete process.env.TMPDIR;
    try {
      const testDir = mkScratch('benchtest-', '/tmp');
      const scratch = path.join(testDir, 'jdg-oc-x');
      fs.mkdirSync(scratch);
      const { script } = makeIsolation({ mode: 'unshare', scratchRoot: scratch });
      const lines = script.split('\n');
      const tmpReal = fs.realpathSync('/tmp');
      const roTmp = lines.indexOf(`ro '${tmpReal}'`);
      const rwScratch = lines.findIndex((l) => /^mount --bind .*remount,rw,bind/.test(l) && l.includes(`'${fs.realpathSync(scratch)}'`));
      assert.ok(roTmp >= 0, '/tmp is made read-only');
      assert.ok(rwScratch > roTmp, 'the scratch root is made writable after /tmp went read-only');
      const rw = lines.filter((l) => /remount,rw,bind/.test(l));
      assert.equal(rw.length, 1, 'no other directory is made writable');
      assert.ok(!lines.some((l) => l.includes(`'${fs.realpathSync(testDir)}'`) && !l.includes(fs.realpathSync(scratch))), 'the test dir itself has no mount of its own, so it stays read-only');
    } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
  });
}
