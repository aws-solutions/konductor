// SPDX-License-Identifier: Apache-2.0
'use strict';

// The macOS isolation mode: a generated sandbox-exec profile in place of the mount namespace.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { makeIsolation, probeSandboxExec, resolveIsolation, autoMode, ISOLATE_MODES } = require('../lib/isolate.js');
const { makeScratchRoot } = require('../lib/sandbox.js');

const probe = process.platform === 'darwin' ? probeSandboxExec() : { ok: false, reason: 'not macOS' };
const skip = probe.ok ? false : `sandbox-exec unavailable: ${probe.reason}`;

function inSandbox(scratch, script, opts = {}) {
  const iso = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, ...opts });
  const w = iso.wrap('/bin/sh', ['-c', script]);
  return spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
}

test('sandbox-exec is an --isolate mode beside unshare and none, and auto picks it only on macOS', () => {
  assert.deepEqual(ISOLATE_MODES, ['auto', 'unshare', 'sandbox-exec', 'none']);
  assert.equal(autoMode('darwin'), 'sandbox-exec');
  assert.equal(autoMode('linux'), 'unshare');
  assert.throws(() => resolveIsolation('chroot'), /--isolate must be one of auto, unshare, sandbox-exec, none/);
});

test('--isolate sandbox-exec aborts when its probe fails', () => {
  const failing = () => ({ ok: false, reason: 'spawnSync sandbox-exec ENOENT' });
  assert.throws(() => resolveIsolation('sandbox-exec', undefined, failing), /--isolate sandbox-exec is not usable here: spawnSync sandbox-exec ENOENT/);
});

test('the profile denies home writes, allows the scratch root and ~/Library, and denies credential reads', () => {
  const scratch = makeScratchRoot();
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-home-'));
    const { profile, wrap } = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, home, hide: ['.site-token'] });
    const homeReal = fs.realpathSync(home);
    const at = (s) => profile.indexOf(s);
    assert.ok(at(`(deny file-write*\n  (subpath "${homeReal}")`) >= 0, profile);
    assert.ok(at(`(subpath "${path.join(homeReal, 'Library')}")`) > at('(deny file-write*'), 'the ~/Library allow follows the home deny');
    assert.ok(at(`(subpath "${fs.realpathSync(scratch)}")`) > at('(allow file-write*'), 'the scratch allow follows the deny');
    for (const p of ['.ssh', '.kiro', '.konductor', '.site-token', 'Library/Application Support/kiro-cli/data.sqlite3']) {
      assert.ok(at(`(subpath "${path.join(homeReal, p)}")`) > at('(deny file-read* file-write*'), p);
    }
    const launchAgents = at(`(subpath "${path.join(homeReal, 'Library/LaunchAgents')}")`);
    assert.ok(launchAgents > at(`(subpath "${path.join(homeReal, 'Library')}")`), 'the LaunchAgents deny follows the ~/Library allow');
    assert.ok(profile.lastIndexOf('(deny file-write*', launchAgents) > at('(allow file-write*'), 'LaunchAgents sits in a write deny');
    const snapshot = profile.split('\n').find((l) => l.includes('TimeMachine'));
    for (const n of ['ssh', 'aws', 'gnupg', 'netrc', 'zsh_history', 'site-token', 'claude', 'kiro', 'konductor']) {
      assert.ok(snapshot.includes(`\\.${n}`), `the snapshot deny covers .${n}`);
    }
    assert.match(profile, /\(deny process-exec\n {2}\(literal "\/usr\/bin\/open"\)/);
    assert.ok(profile.indexOf('(literal "/bin/launchctl")') > at('(deny process-exec'), 'launchctl cannot run');
    assert.ok(at(`(subpath "${path.join(homeReal, 'Library/Keychains')}")`) > at('(deny file-read* file-write*'), 'the user keychains cannot be read');
    assert.ok(profile.indexOf('(literal "/usr/bin/security")') > at('(deny process-exec'), 'the security CLI cannot run');
    assert.ok(profile.indexOf('(regex #"/git-credential-osxkeychain$")') > at('(deny process-exec'), 'the osxkeychain credential helper cannot run');
    assert.ok(profile.includes(`(remote unix-socket (subpath "${path.join(homeReal, '.ssh')}"))`), 'masked paths are denied as Unix-socket peers');
    assert.ok(profile.includes('(remote unix-socket (regex #"^(/System/Volumes/Data)?/private/var/run/com\\.apple\\.launchd\\.[^/]+(/|$)"))'), 'the launchd ssh-agent socket is denied');
    assert.doesNotMatch(profile, /remote ip/);
    assert.deepEqual(wrap('a', ['b']), { file: 'sandbox-exec', args: ['-p', profile, 'a', 'b'] });
    fs.rmSync(home, { recursive: true, force: true });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a home under /Users is also denied through the data volume path', () => {
  const scratch = makeScratchRoot();
  try {
    const { profile } = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, home: os.homedir() });
    const home = fs.realpathSync(os.homedir());
    if (home.startsWith('/Users/')) assert.ok(profile.includes(`(subpath "/System/Volumes/Data${home}")`), profile);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('inside the sandbox the scratch root is writable and the real home, temp dir and LaunchAgents are not', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const s = fs.realpathSync(scratch);
    const home = os.homedir();
    const r = inSandbox(scratch, [
      `touch ${s}/ok || exit 2`,
      `touch "${home}/.bench-sb-probe" 2>/dev/null && exit 3`,
      `touch "${fs.realpathSync(os.tmpdir())}/bench-sb-probe" 2>/dev/null && exit 4`,
      `[ -d "${home}/Library/LaunchAgents" ] && [ -w "${home}/Library/LaunchAgents" ] && exit 5`,
      'exit 0',
    ].join('; '));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(home, '.bench-sb-probe')), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('hidden home paths and masks cannot be read from the sandbox', { skip }, () => {
  const scratch = makeScratchRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mask-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret'), 'x');
    const r = inSandbox(scratch, `cat "${path.join(outside, 'secret')}" >/dev/null 2>&1 && exit 3; exit 0`, { mask: [outside] });
    assert.equal(r.status, 0, r.stderr);
    const ssh = path.join(os.homedir(), '.ssh');
    if (fs.existsSync(ssh)) {
      const s = inSandbox(scratch, `ls "${ssh}" >/dev/null 2>&1 && exit 3; exit 0`);
      assert.equal(s.status, 0, s.stderr);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

function runInSandbox(iso, file, args) {
  const w = iso.wrap(file, args);
  return new Promise((resolve) => {
    const c = require('node:child_process').spawn(w.file, w.args, { stdio: 'ignore' });
    const t = setTimeout(() => c.kill('SIGKILL'), 10000);
    c.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });
}

test('a masked Unix socket outside scratch cannot be connected from the sandbox', { skip }, async () => {
  const scratch = makeScratchRoot();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sock-')));
  const sock = path.join(outside, 'runtime.sock');
  const server = net.createServer((c) => { c.on('error', () => {}); c.end('hi'); });
  await new Promise((resolve) => server.listen(sock, resolve));
  try {
    const code = `require('net').connect(${JSON.stringify(sock)}).on('connect', () => process.exit(0)).on('error', () => process.exit(7))`;
    const open = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch });
    assert.equal(await runInSandbox(open, process.execPath, ['-e', code]), 0, 'an unmasked socket connects');
    const masked = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, mask: [sock] });
    assert.equal(await runInSandbox(masked, process.execPath, ['-e', code]), 7, 'the masked socket is refused');
  } finally {
    server.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('the launchd ssh-agent socket is refused and launchctl cannot run in the sandbox', { skip }, async () => {
  const scratch = makeScratchRoot();
  try {
    const iso = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch });
    assert.notEqual(await runInSandbox(iso, '/bin/launchctl', ['print', `gui/${os.userInfo().uid}`]), 0, 'launchctl is denied');
    const agent = process.env.SSH_AUTH_SOCK;
    if (agent && /^\/(private\/)?var\/run\/com\.apple\.launchd\./.test(agent)) {
      const code = `require('net').connect(${JSON.stringify(agent)}).on('connect', () => process.exit(0)).on('error', () => process.exit(7))`;
      assert.equal(await runInSandbox(iso, process.execPath, ['-e', code]), 7, 'the ssh-agent socket is refused');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the login keychain cannot be opened or read from the sandbox', { skip }, () => {
  const scratch = makeScratchRoot();
  try {
    const keychain = path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
    if (!fs.existsSync(keychain)) return;
    const r = inSandbox(scratch, [
      `/usr/bin/security show-keychain-info "${keychain}" >/dev/null 2>&1 && exit 3`,
      `head -c1 "${keychain}" >/dev/null 2>&1 && exit 4`,
      'exit 0',
    ].join('; '));
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('offline blocks outbound connections and keeps loopback', { skip }, async () => {
  const scratch = makeScratchRoot();
  const server = net.createServer((c) => { c.on('error', () => {}); c.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const connect = (host, p) => `require('net').connect(${p}, '${host}').on('connect', () => process.exit(0)).on('error', () => process.exit(7))`;
    const run = (code) => {
      const iso = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, offline: true });
      const w = iso.wrap(process.execPath, ['-e', code]);
      return new Promise((resolve) => {
        const c = require('node:child_process').spawn(w.file, w.args, { stdio: 'ignore' });
        const t = setTimeout(() => c.kill('SIGKILL'), 10000);
        c.on('exit', (code_) => { clearTimeout(t); resolve(code_); });
      });
    };
    assert.equal(await run(connect('127.0.0.1', port)), 0, 'loopback works');
    assert.equal(await run(connect('1.1.1.1', 443)), 7, 'outbound is denied');
  } finally {
    server.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
