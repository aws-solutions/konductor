// SPDX-License-Identifier: Apache-2.0
// Tests for the spawn helper (scripts/bench/lib/proc.js). The children are short node scripts; nothing
// reaches the network.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { run, MAX_TIMEOUT_MS } = require('../../../scripts/bench/lib/proc');
const helpers = require('./helpers');

const NODE = process.execPath;
const script = (source) => ['-e', source];

test('run: collects stdout and stderr, returns the exit code and a duration, never rejects on failure', async () => {
  const result = await run(
    NODE,
    script(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ),
  );
  assert.equal(result.code, 3);
  assert.equal(result.stdout, 'out');
  assert.equal(result.stderr, 'err');
  assert.equal(result.timedOut, false);
  assert.equal(result.overflow, false);
  assert.ok(Number.isFinite(result.ms) && result.ms >= 0);
});

test('run: PWD is set to cwd, because OpenCode reads its project config from PWD', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const result = await run(
      NODE,
      script(
        'process.stdout.write(JSON.stringify([process.env.PWD, process.cwd()]))',
      ),
      { cwd: dir, env: { ...process.env, PWD: '/somewhere/else' } },
    );
    const [pwd, cwd] = JSON.parse(result.stdout);
    assert.equal(pwd, dir);
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(dir));
  });
});

test('run: env replaces the environment whole', async () => {
  const result = await run(
    NODE,
    script(
      'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))',
    ),
    { env: { ONLY_THIS: '1' } },
  );
  // Some platforms add a variable or two of their own to every process; the parent's are gone.
  const names = JSON.parse(result.stdout);
  assert.ok(names.includes('ONLY_THIS'));
  assert.ok(!names.includes('PATH'), 'the parent PATH was not passed');
});

test('run: the timeout kills the child with SIGKILL and says so', async () => {
  const result = await run(NODE, script('setInterval(() => {}, 1000)'), {
    timeoutMs: 200,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(result.ms < 10000);
});

test('run: stdin is written and closed', async () => {
  const result = await run(
    NODE,
    script(
      'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>process.stdout.write(s.toUpperCase()))',
    ),
    { stdin: 'hello' },
  );
  assert.equal(result.stdout, 'HELLO');
});

test('run: output past the cap kills the child and sets overflow; what was kept stays under the cap', async () => {
  const result = await run(
    NODE,
    script(
      'const s="x".repeat(65536); setInterval(() => process.stdout.write(s), 1)',
    ),
    { maxOutputChars: 100000, timeoutMs: 20000 },
  );
  assert.equal(result.overflow, true);
  assert.equal(result.timedOut, false);
  assert.ok(result.stdout.length <= 100000);
});

test('run: a command that does not exist resolves with code -1 and a spawn error', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const result = await run(path.join(dir, 'no-such-command'), []);
    assert.equal(result.code, -1);
    assert.match(result.stderr, /^spawn error: .*ENOENT/);
  });
});

test('run: an argument the OS refuses resolves with a spawn error instead of throwing', async () => {
  const result = await run(NODE, ['-e', 'a\u0000b']);
  assert.equal(result.code, -1);
  assert.match(result.stderr, /^spawn error: /);
});

test('run: bad options are refused before anything starts', () => {
  assert.throws(() => run(NODE, 'not an array'), /args must be an array/);
  for (const timeoutMs of [0, -1, NaN, Infinity])
    assert.throws(
      () => run(NODE, [], { timeoutMs }),
      /timeoutMs must be a number above 0/,
    );
});

test('run: bad timeout and grace options are refused', () => {
  assert.throws(
    () => run(NODE, [], { timeoutMs: MAX_TIMEOUT_MS + 1 }),
    new RegExp(`timeoutMs must be at most ${MAX_TIMEOUT_MS}`),
  );
  for (const killGraceMs of [0, -1, NaN, Infinity])
    assert.throws(
      () => run(NODE, [], { killGraceMs }),
      /killGraceMs must be a number above 0/,
    );
});

test('run: the largest timeout setTimeout takes is accepted and the child still finishes at once', async () => {
  const result = await run(NODE, script('process.exit(0)'), {
    timeoutMs: MAX_TIMEOUT_MS,
  });
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
});

test('run: a process that keeps the output pipes open after the kill does not hold the result past the grace time', async () => {
  // `sleep 4 &` inherits the pipes; killing the shell leaves it holding them, so 'close' would wait 4 seconds.
  const result = await run('sh', ['-c', 'sleep 4 & sleep 4'], {
    timeoutMs: 200,
    killGraceMs: 200,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, null);
  assert.ok(result.ms < 3000, `returned after ${result.ms} ms`);
});

test('run: the same holds after an output flood', async () => {
  const result = await run('sh', ['-c', 'sleep 4 & yes x'], {
    maxOutputChars: 1000,
    timeoutMs: 20000,
    killGraceMs: 200,
  });
  assert.equal(result.overflow, true);
  assert.equal(result.timedOut, false);
  assert.ok(result.ms < 3000, `returned after ${result.ms} ms`);
});

// The exit hooks run in the process that calls run(), so each test starts a host process that does, with a
// child that writes its pid to a file and then idles. The test ends the host and checks that the child is gone.
const PROC_MODULE = require.resolve('../../../scripts/bench/lib/proc');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = condition();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await sleep(25);
  }
}
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const hostSource = (pidFile, { exitOnceChildIsUp = false } = {}) => `
const fs = require('fs');
const { run } = require(${JSON.stringify(PROC_MODULE)});
const childSource = ${JSON.stringify(
  `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
)};
run(process.execPath, ['-e', childSource], { timeoutMs: 60000 });
${
  exitOnceChildIsUp
    ? `setInterval(() => { if (fs.existsSync(${JSON.stringify(pidFile)})) process.exit(0); }, 20);`
    : ''
}
`;

/** Starts a host and waits for its child's pid. Returns { host, pid, exited } where `exited` resolves to the host's exit. */
async function startHost(pidFile, options) {
  const host = spawn(NODE, ['-e', hostSource(pidFile, options)], {
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) =>
    host.on('exit', (code, signal) => resolve({ code, signal })),
  );
  const pid = await waitFor(() => {
    try {
      const text = fs.readFileSync(pidFile, 'utf8');
      return /^\d+$/.test(text) ? Number(text) : 0;
    } catch {
      return 0;
    }
  });
  return { host, pid, exited };
}

for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
])
  test(`exit hooks: ${signal} stops the host with exit code ${exitCode} and kills its running child`, async () => {
    await helpers.withTmpAsync(async (dir) => {
      const { host, pid, exited } = await startHost(path.join(dir, 'pid'));
      try {
        host.kill(signal);
        let giveUp;
        const result = await Promise.race([
          exited,
          new Promise((resolve) => {
            giveUp = setTimeout(resolve, 10000, 'the host did not exit');
          }),
        ]);
        clearTimeout(giveUp);
        assert.deepEqual(result, { code: exitCode, signal: null });
        await waitFor(() => !isAlive(pid));
      } finally {
        host.kill('SIGKILL');
        if (isAlive(pid)) process.kill(pid, 'SIGKILL');
      }
    });
  });

test('exit hooks: a host that calls process.exit does not leave its running child behind', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const { host, pid, exited } = await startHost(path.join(dir, 'pid'), {
      exitOnceChildIsUp: true,
    });
    try {
      assert.deepEqual(await exited, { code: 0, signal: null });
      await waitFor(() => !isAlive(pid));
    } finally {
      host.kill('SIGKILL');
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
    }
  });
});
