// SPDX-License-Identifier: Apache-2.0
// Tests for the job launcher (scripts/bench/lib/launch.js and scripts/bench/launch.js): checked arguments, the private
// job folder, one live job per job and skill, kept logs, the child's environment, and the real command line with a
// dry-run job. Every launch runs on a copy of the fixture repo in a temp folder. No model or AWS call: the start is a
// stub, or the job runs in its own --dry-run mode, which spends nothing.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const launchLib = require('../../../scripts/bench/lib/launch');
const launchCli = require('../../../scripts/bench/launch');
const { UsageError } = require('../../../scripts/bench/lib/cli-args');
const jobDir = require('../../../scripts/bench/lib/job-dir');
const { REPO_ROOT } = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

const { resolveJobRequest, launchJob, LaunchRefusedError, JOB_SCRIPT } =
  launchLib;
const SKILL = helpers.SKILL;
const LAUNCH_JS = path.join(REPO_ROOT, 'scripts', 'bench', 'launch.js');
const mode = (file) => fs.statSync(file).mode & 0o777;
const DEAD_PID = 99999999;
/** The live-process check finds the test process itself when the job script "is" the node binary. */
const THIS_PROCESS = path.basename(process.execPath);

/** A stub for proc.startDetached: records each start and answers with `pid` (default: this test process). */
function stubStart(pid = process.pid) {
  const calls = [];
  const start = (command, args, options) => {
    calls.push({ command, args, options });
    fs.writeSync(options.outputFd, `started ${args[1]}\n`);
    return pid;
  };
  return { start, calls };
}

/** Runs callback(root) on a throw-away copy of the fixture repo. */
const withRepo = (callback) =>
  helpers.withTmp((dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    return callback(root, dir);
  });

const request = (root, extra = {}) =>
  resolveJobRequest('pairs', { skills: SKILL, root, ...extra });

test('resolveJobRequest: a valid request is checked against the root it names, with skills sorted and absolute paths', () => {
  withRepo((root, dir) => {
    const settings = path.join(dir, 'settings.json');
    helpers.write(settings, helpers.settingsWith({ max_usd: 5 }));
    const resolved = resolveJobRequest('pairs', {
      skills: `pantry-note, ${SKILL},pantry-note`,
      root: path.relative(process.cwd(), root),
      run: 'r1',
      maxUsd: '2.5',
      config: path.relative(process.cwd(), settings),
    });
    assert.equal(resolved.job, 'pairs');
    assert.deepEqual(resolved.skills, [SKILL, 'pantry-note']);
    assert.equal(resolved.layout.root, root);
    assert.equal(resolved.layout.runId, 'r1');
    assert.equal(resolved.config.max_usd, 2.5, '--max-usd wins over the file');
    assert.equal(resolved.maxUsdText, '2.5');
    assert.equal(resolved.configFile, settings);
    assert.deepEqual(launchLib.jobArguments(resolved, { dryRun: true }), [
      'pairs',
      '--skills',
      `${SKILL},pantry-note`,
      '--run',
      'r1',
      '--root',
      root,
      '--max-usd',
      '2.5',
      '--config',
      settings,
      '--dry-run',
    ]);
    assert.deepEqual(launchLib.jobArguments(request(root), { dryRun: false }), [
      'pairs',
      '--skills',
      SKILL,
      '--run',
      'default',
      '--root',
      root,
    ]);
  });
});

test('resolveJobRequest: every bad value is a usage error that names it, before anything starts', () => {
  withRepo((root, dir) => {
    const badSettings = path.join(dir, 'bad.json');
    helpers.write(badSettings, { no_such_setting: 1 });
    const cases = [
      [
        () => resolveJobRequest('', { skills: SKILL, root }),
        /name a job: one of pairs/,
      ],
      [
        () => resolveJobRequest('rm', { skills: SKILL, root }),
        /unknown job "rm"; jobs: pairs/,
      ],
      [
        () => resolveJobRequest('judge', { skills: SKILL, root }),
        /unknown job "judge"/,
      ],
      [() => request(root, { skills: undefined }), /--skills is required/],
      [() => request(root, { skills: ' , ' }), /at least one skill/],
      [
        () => request(root, { skills: 'nope' }),
        /unknown skill\(s\) in --skills: nope/,
      ],
      [() => request(root, { skills: `${SKILL};id` }), /unknown skill\(s\)/],
      [() => request(root, { skills: '../brew-log' }), /unknown skill\(s\)/],
      [() => request(root, { run: '../x' }), /unsafe run id/],
      [() => request(root, { run: 'ledger.jsonl' }), /reserved/],
      [
        () => request(root, { maxUsd: '1e3' }),
        /--max-usd: must be a plain decimal/,
      ],
      [() => request(root, { maxUsd: '0' }), /--max-usd/],
      [() => request(root, { maxUsd: '500' }), /max_usd/],
      [() => request(root, { config: badSettings }), /no_such_setting/],
      [
        () => request(root, { config: path.join(dir, 'missing.json') }),
        /missing\.json/,
      ],
      [
        // A wrong --root is named, not its missing settings file and the cp line that would fix nothing.
        () => request(path.join(dir, 'nowhere')),
        /^the repository root .*nowhere has no skills\/ folder$/,
      ],
    ];
    for (const [call, message] of cases)
      assert.throws(
        call,
        (error) => error instanceof UsageError && message.test(error.message),
        String(message),
      );
  });
});

test('resolveJobRequest: a name that only an object inherits is not a job', () => {
  withRepo((root) => {
    for (const name of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ])
      assert.throws(
        () => resolveJobRequest(name, { skills: SKILL, root }),
        (error) =>
          error instanceof UsageError &&
          error.message.startsWith(`unknown job "${name}"`),
        name,
      );
  });
});

test('resolveJobRequest: a bug while loading the settings is rethrown as it is, not turned into a usage error', (context) => {
  withRepo((root, dir) => {
    const settingsFile = path.join(dir, 'settings.json');
    fs.copyFileSync(
      path.join(REPO_ROOT, 'bench', 'config.example.json'),
      settingsFile,
    );
    const readFileSync = fs.readFileSync;
    context.mock.method(fs, 'readFileSync', (file, ...rest) => {
      if (path.resolve(String(file)) === settingsFile)
        throw new TypeError('simulated bug');
      return readFileSync.call(fs, file, ...rest);
    });
    assert.throws(
      () => request(root, { config: settingsFile }),
      (error) =>
        error instanceof TypeError &&
        !(error instanceof UsageError) &&
        error.message === 'simulated bug',
    );
  });
});

test('resolveJobRequest: a skill folder whose name is not a skill name is refused, so it cannot reach a file name', () => {
  withRepo((root) => {
    fs.mkdirSync(path.join(root, 'skills', 'Odd+Name'));
    fs.writeFileSync(
      path.join(root, 'skills', 'Odd+Name', 'SKILL.md'),
      '# odd\n',
    );
    assert.throws(
      () => request(root, { skills: 'Odd+Name' }),
      (error) =>
        error instanceof UsageError &&
        /lowercase letters, digits/.test(error.message),
    );
  });
});

test("resolveJobRequest: the root that is checked is the root the job gets; another checkout's skills do not count", () => {
  withRepo((root, dir) => {
    const other = path.join(dir, 'other');
    fs.mkdirSync(path.join(other, 'skills', 'only-here'), { recursive: true });
    fs.writeFileSync(
      path.join(other, 'skills', 'only-here', 'SKILL.md'),
      '# x\n',
    );
    fs.mkdirSync(path.join(other, 'bench'));
    helpers.write(
      path.join(other, 'bench', 'config.json'),
      helpers.settingsWith(),
    );
    assert.throws(
      () => request(root, { skills: 'only-here' }),
      /unknown skill\(s\) in --skills: only-here/,
    );
    assert.equal(
      resolveJobRequest('pairs', { skills: 'only-here', root: other }).layout
        .root,
      other,
    );
    const { start, calls } = stubStart(DEAD_PID);
    launchJob(request(root), { start });
    assert.deepEqual(
      calls[0].args.slice(
        calls[0].args.indexOf('--root'),
        calls[0].args.indexOf('--root') + 2,
      ),
      ['--root', root],
    );
    assert.equal(calls[0].options.cwd, root);
  });
  assert.equal(
    resolveJobRequest('pairs', {
      skills: 'adr-generator',
      config: path.join(REPO_ROOT, 'bench', 'config.example.json'),
    }).layout.root,
    REPO_ROOT,
    'no --root: this checkout',
  );
});

test('launchJob: private 0700 job folder, 0600 log and pid file, the checked arguments, detached start', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const started = launchJob(request(root), {
      start,
      jobScript: THIS_PROCESS,
      now: () => Date.UTC(2026, 0, 2),
    });
    const dir = path.join(root, 'bench', 'out', 'default', 'jobs');
    assert.deepEqual(started, {
      job: 'pairs',
      run_id: 'default',
      skills: [SKILL],
      dry_run: false,
      pid: process.pid,
      already_running: false,
      log_file: path.join(dir, `pairs.${SKILL}.log`),
      pid_file: path.join(dir, `pairs.${SKILL}.pid`),
    });
    assert.equal(mode(dir), 0o700);
    assert.equal(mode(started.log_file), 0o600);
    assert.equal(mode(started.pid_file), 0o600);
    assert.equal(
      fs.readFileSync(started.log_file, 'utf8'),
      `started pairs\n`,
      'the job writes to its log',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [
      THIS_PROCESS,
      'pairs',
      '--skills',
      SKILL,
      '--run',
      'default',
      '--root',
      root,
    ]);
    assert.ok(
      !fs.existsSync(path.join(dir, jobDir.LAUNCH_LOCK)),
      'the lock is released',
    );
    const record = jobDir.readPidRecord(started.pid_file);
    assert.deepEqual(record, {
      pid: process.pid,
      job: 'pairs',
      key: SKILL,
      skills: [SKILL],
      run_id: 'default',
      dry_run: false,
      script: THIS_PROCESS,
      args: calls[0].args.slice(1),
      started: '2026-01-02T00:00:00.000Z',
    });
  });
});

test('launchJob: the default job script is scripts/bench/job.js of this checkout', () => {
  assert.equal(JOB_SCRIPT, path.join(REPO_ROOT, 'scripts', 'bench', 'job.js'));
  assert.ok(fs.existsSync(JOB_SCRIPT));
  withRepo((root) => {
    const { start, calls } = stubStart(DEAD_PID);
    launchJob(request(root), { start });
    assert.equal(calls[0].args[0], JOB_SCRIPT);
  });
});

test("launchJob: the job gets the caller's environment without the variables that redirect or alter a child", () => {
  withRepo((root) => {
    const { start, calls } = stubStart(DEAD_PID);
    const baseEnv = {
      PATH: '/usr/bin',
      HOME: '/var/empty/someone',
      AWS_PROFILE: 'bench-profile',
      ANTHROPIC_BASE_URL: 'https://elsewhere.example',
      OPENCODE_CONFIG: '/x',
      CLAUDE_CODE_USE_BEDROCK: '0',
      NODE_OPTIONS: '--require /tmp/evil.js',
      BASH_ENV: '/tmp/evil.sh',
    };
    launchJob(request(root), { start, baseEnv });
    assert.deepEqual(calls[0].options.env, {
      PATH: '/usr/bin',
      HOME: '/var/empty/someone',
      AWS_PROFILE: 'bench-profile',
    });
  });
});

test('launchJob: one live job per job and skill list; a second launch returns the running one and starts nothing', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const options = { start, jobScript: THIS_PROCESS };
    const first = launchJob(request(root), options);
    const second = launchJob(
      resolveJobRequest('pairs', { skills: `${SKILL},${SKILL}`, root }),
      options,
    );
    assert.equal(
      second.already_running,
      true,
      'a second launch must not start a second paid job',
    );
    assert.equal(second.pid, first.pid);
    assert.equal(calls.length, 1);
    assert.equal(
      fs.readFileSync(first.log_file, 'utf8'),
      'started pairs\n',
      'the running job keeps its log',
    );
  });
});

test('launchJob: when the job has exited, a new launch starts it again and keeps the old log aside', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const options = { start, jobScript: THIS_PROCESS };
    const first = launchJob(request(root), options);
    jobDir.writePidRecord(first.pid_file, {
      ...jobDir.readPidRecord(first.pid_file),
      pid: DEAD_PID,
    });
    fs.writeFileSync(first.log_file, 'old log');
    const third = launchJob(request(root), options);
    assert.equal(third.already_running, false);
    assert.equal(calls.length, 2);
    const dir = path.dirname(first.log_file);
    const kept = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(`pairs.${SKILL}.log.`));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), 'old log');
    assert.equal(fs.readFileSync(first.log_file, 'utf8'), 'started pairs\n');
    assert.equal(jobDir.readPidRecord(first.pid_file).pid, process.pid);
  });
});

test('launchJob: a pid the system gave to another program is not a live job', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    launchJob(request(root), { start, jobScript: THIS_PROCESS });
    const again = launchJob(request(root), {
      start,
      jobScript: 'definitely-not-this-process-xyz',
    });
    assert.equal(again.already_running, false);
    assert.equal(calls.length, 2);
  });
});

test('launchJob: a launch that shares a skill with a live job of the same kind is refused and starts nothing', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const options = { start, jobScript: THIS_PROCESS };
    launchJob(
      resolveJobRequest('pairs', { skills: `${SKILL},pantry-note`, root }),
      options,
    );
    assert.throws(
      () => launchJob(request(root), options),
      (error) =>
        error instanceof LaunchRefusedError &&
        /a pairs job for brew-log is already running \(pid \d+, pairs\.brew-log\+pantry-note\.pid\)/.test(
          error.message,
        ),
    );
    assert.equal(calls.length, 1);
    assert.ok(
      !fs.existsSync(
        path.join(
          root,
          'bench',
          'out',
          'default',
          'jobs',
          `pairs.${SKILL}.log`,
        ),
      ),
    );
  });
});

test('launchJob: another run id is another job folder, so the same skills may run there', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const options = { start, jobScript: THIS_PROCESS };
    launchJob(request(root), options);
    const other = launchJob(request(root, { run: 'r2' }), options);
    assert.equal(other.already_running, false);
    assert.ok(
      other.log_file.includes(`${path.sep}r2${path.sep}jobs${path.sep}`),
    );
    assert.equal(calls.length, 2);
  });
});

test('launchJob: a dry run is a job of its own; it never blocks a paid job and is never blocked by one', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const options = { start, jobScript: THIS_PROCESS };
    const dry = launchJob(request(root), { ...options, dryRun: true });
    assert.equal(dry.dry_run, true);
    assert.ok(dry.pid_file.endsWith(`pairs.${SKILL}.dry-run.pid`));
    assert.equal(calls[0].args.at(-1), '--dry-run');
    const paid = launchJob(request(root), options);
    assert.equal(
      paid.already_running,
      false,
      'a live dry run does not stand in for the paid job',
    );
    assert.ok(!calls[1].args.includes('--dry-run'));
    const dryAgain = launchJob(
      resolveJobRequest('pairs', { skills: `${SKILL},pantry-note`, root }),
      { ...options, dryRun: true },
    );
    assert.equal(dryAgain.already_running, false);
    assert.equal(
      launchJob(request(root), { ...options, dryRun: true }).already_running,
      true,
    );
    assert.equal(calls.length, 3);
  });
});

/** A process check for a pid that is alive whose command line cannot be read by `ps` or from /proc. */
const BLIND_CHECK = {
  kill: () => true,
  runSync: () => ({ error: new Error('spawn ps ENOENT'), status: null }),
  readFile: () => {
    throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
  },
};

test('launchJob: a pid file whose process cannot be checked is refused and starts nothing, instead of answering already_running', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const first = launchJob(request(root), {
      start,
      jobScript: THIS_PROCESS,
    });
    for (const skills of [SKILL, `${SKILL},pantry-note`]) {
      assert.throws(
        () =>
          launchJob(resolveJobRequest('pairs', { skills, root }), {
            start,
            jobScript: THIS_PROCESS,
            processCheck: BLIND_CHECK,
          }),
        (error) =>
          error instanceof LaunchRefusedError &&
          error.message.includes(`pid ${first.pid}`) &&
          error.message.includes('cannot be read') &&
          error.message.includes(`Remove ${first.pid_file}`) &&
          error.message.includes('nothing was started'),
        skills,
      );
    }
    assert.equal(calls.length, 1);
    assert.equal(
      fs.readFileSync(first.log_file, 'utf8'),
      'started pairs\n',
      'the log of the pid file is untouched',
    );
  });
});

test('launchJob: an unverified process of a dry run or of other skills does not block a launch', () => {
  withRepo((root) => {
    const { start, calls } = stubStart();
    const options = { start, jobScript: THIS_PROCESS };
    launchJob(request(root), { ...options, dryRun: true });
    launchJob(
      resolveJobRequest('pairs', { skills: 'pantry-note', root }),
      options,
    );
    const paid = launchJob(request(root), {
      ...options,
      processCheck: BLIND_CHECK,
    });
    assert.equal(paid.already_running, false, 'the dry run is no overlap');
    assert.equal(calls.length, 3);
  });
});

test('launchJob: the log file descriptor is closed after a start and after a start that throws', (context) => {
  withRepo((root) => {
    const opened = new Set();
    const open = fs.openSync;
    const close = fs.closeSync;
    context.mock.method(fs, 'openSync', (...args) => {
      const fd = open.apply(fs, args);
      opened.add(fd);
      return fd;
    });
    context.mock.method(fs, 'closeSync', (fd) => {
      opened.delete(fd);
      return close.call(fs, fd);
    });
    launchJob(request(root), { start: stubStart(DEAD_PID).start });
    assert.throws(
      () =>
        launchJob(request(root, { run: 'r2' }), {
          start: () => {
            throw new Error('could not start node');
          },
        }),
      /could not start node/,
    );
    assert.equal(opened.size, 0, 'no descriptor stays open');
  });
});

test('launchJob: a launch lock held by another launch refuses the launch and starts nothing', () => {
  withRepo((root) => {
    const dir = jobDir.ensureJobDir(
      path.join(root, 'bench', 'out', 'default', 'jobs'),
    );
    fs.writeFileSync(path.join(dir, jobDir.LAUNCH_LOCK), 'other-launch');
    const { start, calls } = stubStart();
    let clock = Date.now();
    assert.throws(
      () =>
        launchJob(request(root), {
          start,
          lock: {
            now: () => clock,
            sleep: (ms) => {
              clock += ms;
            },
            timeoutMs: 500,
          },
        }),
      (error) =>
        error instanceof LaunchRefusedError &&
        /nothing was started/.test(error.message),
    );
    assert.equal(calls.length, 0);
  });
});

test('launchJob: a start that fails leaves no pid file, so the next launch tries again', () => {
  withRepo((root) => {
    const failing = () => {
      throw new Error('could not start node');
    };
    assert.throws(
      () => launchJob(request(root), { start: failing }),
      /could not start node/,
    );
    const dir = path.join(root, 'bench', 'out', 'default', 'jobs');
    assert.ok(!fs.existsSync(path.join(dir, `pairs.${SKILL}.pid`)));
    assert.ok(!fs.existsSync(path.join(dir, jobDir.LAUNCH_LOCK)));
    const { start, calls } = stubStart(DEAD_PID);
    assert.equal(launchJob(request(root), { start }).already_running, false);
    assert.equal(calls.length, 1);
  });
});

/** Runs the launcher's main() with captured output; returns { code, out, err, json }. */
function runMain(argv, launchOptions) {
  let out = '';
  let err = '';
  const code = launchCli.main(
    argv,
    { out: (text) => (out += text), err: (text) => (err += text) },
    { env: {}, launchOptions },
  );
  return { code, out, err, json: out.startsWith('{') ? JSON.parse(out) : null };
}

test('launch main: one JSON line on success, and on every failure an error line with the exit code', () => {
  withRepo((root) => {
    const { start } = stubStart();
    const ok = runMain(['pairs', '--skills', SKILL, '--root', root], {
      start,
      jobScript: THIS_PROCESS,
    });
    assert.equal(ok.code, 0);
    assert.equal(ok.out.split('\n').length, 2, 'exactly one line');
    assert.equal(ok.json.already_running, false);
    const refused = runMain(
      ['pairs', '--skills', `${SKILL},pantry-note`, '--root', root],
      { start, jobScript: THIS_PROCESS },
    );
    assert.equal(refused.code, 1);
    assert.match(refused.json.error, /already running/);
    assert.equal(refused.json.exit_code, 1);
    for (const [argv, pattern] of [
      [['pairs', '--skills', 'nope', '--root', root], /unknown skill/],
      [['pairs', '--root', root], /--skills is required/],
      [
        ['pairs', '--skills', SKILL, '--root', root, '--dry-run=yes'],
        /--dry-run does not take a value/,
      ],
      [
        ['pairs', '--skills', SKILL, '--profile', 'x'],
        /unknown option --profile/,
      ],
      [['--skills', SKILL], /first word must be a job name/],
      [['nope', '--skills', SKILL], /unknown job "nope"/],
    ]) {
      const result = runMain(argv, { start });
      assert.equal(result.code, 64, argv.join(' '));
      assert.match(result.json.error, pattern);
      assert.equal(result.json.exit_code, 64);
      assert.doesNotMatch(result.json.error, /\n|^error:/);
    }
  });
  const help = runMain(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /^Usage: node scripts\/bench\/launch\.js <job>/);
  assert.match(runMain([]).out, /^Usage:/);
});

test('launch main: a settings problem gives every reason in the one error line, without the usage hint', () => {
  withRepo((root, dir) => {
    const { start } = stubStart();
    const tooBig = runMain(
      ['pairs', '--skills', SKILL, '--root', root, '--max-usd', '500'],
      { start },
    );
    assert.equal(tooBig.code, 64);
    assert.match(
      tooBig.json.error,
      /^invalid benchmark settings \(.*config\.json\): .*max_usd/,
    );
    assert.match(tooBig.json.error, /\b500\b/);
    assert.doesNotMatch(tooBig.json.error, /\n|--help|^error:|- limits/);
    const settings = path.join(dir, 'unknown.json');
    helpers.write(settings, { no_such_setting: 1 });
    const unknown = runMain(
      ['pairs', '--skills', SKILL, '--root', root, '--config', settings],
      { start },
    );
    assert.equal(unknown.code, 64);
    assert.match(
      unknown.json.error,
      /^invalid benchmark settings .*no_such_setting/,
    );
    assert.doesNotMatch(unknown.json.error, /\n|--help/);
  });
});

test('launch main: a write that fails says "cannot write" and exits 74, also for a missing path', () => {
  withRepo((root) => {
    for (const [code, syscall, reason] of [
      [
        'EACCES',
        'open',
        /^cannot write file: permission denied \(\/x\/jobs\)$/,
      ],
      [
        'ENOENT',
        'open',
        /^cannot write file: no such file or folder \(\/x\/jobs\)$/,
      ],
      [
        'EACCES',
        'scandir',
        /^cannot write folder: permission denied \(\/x\/jobs\)$/,
      ],
    ]) {
      const start = () => {
        throw Object.assign(new Error('fail'), {
          code,
          syscall,
          path: '/x/jobs',
        });
      };
      const result = runMain(['pairs', '--skills', SKILL, '--root', root], {
        start,
      });
      assert.equal(result.code, 74, `${code} ${syscall}`);
      assert.match(result.json.error, reason);
      assert.equal(result.json.exit_code, 74);
    }
  });
});

test('launch main: --help after other flags prints the usage and exits 0; the stack of a bug goes to stderr only with BENCH_DEBUG, redacted', () => {
  withRepo((root) => {
    const help = runMain(['pairs', '--skills', SKILL, '--help']);
    assert.equal(help.code, 0);
    assert.match(help.out, /^Usage: node scripts\/bench\/launch\.js <job>/);
    const secret = 'AKIA' + 'EXAMPLEFIXTURE12';
    const start = () => {
      throw new Error(`boom ${secret}`);
    };
    let out = '';
    let err = '';
    const code = launchCli.main(
      ['pairs', '--skills', SKILL, '--root', root],
      { out: (text) => (out += text), err: (text) => (err += text) },
      { env: { BENCH_DEBUG: '1' }, launchOptions: { start } },
    );
    assert.equal(code, 70);
    assert.equal(
      out.trim().split('\n').length,
      1,
      'the JSON line stays one line',
    );
    assert.doesNotMatch(out, /\sat .*:\d+:\d+/, 'no stack in the JSON line');
    assert.match(err, /\n\s+at /, 'the stack is on stderr');
    assert.match(err, /boom \[REDACTED_AWS_KEY_ID\]/);
    assert.ok(!err.includes(secret) && !out.includes(secret));
  });
});

test('launch main: a refusal is one JSON line with exit 1, and BENCH_DEBUG adds no stack for it', () => {
  withRepo((root) => {
    let out = '';
    let err = '';
    const code = launchCli.main(
      ['pairs', '--skills', SKILL, '--root', root],
      { out: (text) => (out += text), err: (text) => (err += text) },
      {
        env: { BENCH_DEBUG: '1' },
        launchOptions: {
          start: () => {
            throw new LaunchRefusedError('another launch holds the lock');
          },
        },
      },
    );
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(out), {
      error: 'another launch holds the lock',
      exit_code: 1,
    });
    assert.equal(err, '', 'a refusal has no stack to show');
  });
});

test('launch.js and job.js take the one table of flags that lib/launch.js keeps', () => {
  const jobCli = require('../../../scripts/bench/job');
  assert.equal(launchCli.VALUE_FLAGS, launchLib.VALUE_FLAGS);
  assert.equal(launchCli.BOOL_FLAGS, launchLib.BOOL_FLAGS);
  assert.equal(jobCli.VALUE_FLAGS, launchLib.VALUE_FLAGS);
  assert.equal(jobCli.BOOL_FLAGS, launchLib.BOOL_FLAGS);
  // A flag the options of resolveJobRequest read has an entry, so a request option cannot be unreachable.
  assert.deepEqual(Object.values(launchLib.VALUE_FLAGS).sort(), [
    'config',
    'maxUsd',
    'root',
    'run',
    'skills',
  ]);
  assert.deepEqual(Object.values(launchLib.BOOL_FLAGS).sort(), [
    'dryRun',
    'help',
    'help',
  ]);
});

test('parseJobCommand: no job, --help and -h answer help; a valid command gives the job, its options and the checked request', () => {
  const { parseJobCommand } = launchLib;
  for (const argv of [
    [],
    ['--help'],
    ['-h'],
    ['pairs', '--help'],
    ['pairs', '-h'],
    ['pairs', '--skills', SKILL, '--help'],
  ])
    assert.deepEqual(parseJobCommand(argv), { help: true }, argv.join(' '));
  withRepo((root) => {
    const parsed = parseJobCommand([
      'pairs',
      '--skills',
      SKILL,
      '--root',
      root,
      '--max-usd',
      '2.5',
      '--dry-run',
    ]);
    assert.equal(parsed.job, 'pairs');
    assert.deepEqual(parsed.options, {
      skills: SKILL,
      root,
      maxUsd: '2.5',
      dryRun: true,
    });
    assert.equal(parsed.request.job, 'pairs');
    assert.deepEqual(parsed.request.skills, [SKILL]);
    assert.equal(parsed.request.layout.root, root);
    assert.equal(parsed.request.maxUsdText, '2.5');
    assert.equal(parsed.request.config.max_usd, 2.5);
  });
});

test('parseJobCommand: a first word that is a flag, an unknown, repeated or valueless flag and an unknown job are usage errors', () => {
  const { parseJobCommand } = launchLib;
  for (const [argv, pattern] of [
    [['--skills', SKILL], /the first word must be a job name, got --skills/],
    [['pairs', '--nope'], /unknown option --nope/],
    [['pairs', '--skills', SKILL, '--skills', SKILL], /given more than once/],
    [['pairs', '--skills'], /--skills needs a value/],
    [['nonesuch', '--skills', SKILL], /unknown job "nonesuch"/],
  ])
    assert.throws(
      () => parseJobCommand(argv),
      (error) => error instanceof UsageError && pattern.test(error.message),
      argv.join(' '),
    );
});

test('launch main: a bug is exit 70 with a redacted one-line error; the stack goes to stderr only with BENCH_DEBUG', () => {
  withRepo((root) => {
    const secret = 'AKIA' + 'EXAMPLEFIXTURE12';
    const start = () => {
      throw new Error(`boom ${secret}`);
    };
    const result = runMain(['pairs', '--skills', SKILL, '--root', root], {
      start,
    });
    assert.equal(result.code, 70);
    assert.match(
      result.json.error,
      /internal error, this is a bug in the benchmark: boom \[REDACTED_AWS_KEY_ID\]/,
    );
    assert.ok(!result.out.includes(secret));
    assert.equal(result.err, '');
  });
});

/** The longest a real launcher call may take; it returns in well under a second, so a call that does not is killed. */
const CLI_TIMEOUT_MS = 60000;

/** The real CLI in a child process, with a minimal environment. It is killed if it does not exit by itself. */
function cli(args) {
  return spawnSync(process.execPath, [LAUNCH_JS, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '' },
    timeout: CLI_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
}

/** Ends the detached job `pid` and its process group, if it is still running. The job is its own group leader. */
function killJob(pid) {
  for (const target of [-pid, pid])
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      /* already gone */
    }
}

test('launch CLI end to end with --dry-run: the detached job runs, logs to the private job folder, spends nothing', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const result = cli([
      'pairs',
      '--skills',
      SKILL,
      '--root',
      root,
      '--run',
      'r1',
      '--dry-run',
    ]);
    assert.equal(
      result.status,
      0,
      `${result.error || ''}${result.stderr}${result.stdout}`,
    );
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const started = JSON.parse(result.stdout);
    assert.equal(started.already_running, false);
    assert.ok(Number.isInteger(started.pid));
    assert.equal(
      started.log_file,
      path.join(
        root,
        'bench',
        'out',
        'r1',
        'jobs',
        `pairs.${SKILL}.dry-run.log`,
      ),
    );
    try {
      let log = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !/"exit_code"/.test(log)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        log = fs.existsSync(started.log_file)
          ? fs.readFileSync(started.log_file, 'utf8')
          : '';
      }
      assert.match(
        log,
        /pairs: skills brew-log; subject runs 0\/10 current, 10 to run/,
      );
      assert.match(log, /would run brew-log\/b1\/brew-log-rules-1:with/);
      const last = JSON.parse(log.trim().split('\n').at(-1));
      assert.equal(last.status, 'dry-run');
      assert.equal(last.exit_code, 0);
      assert.ok(
        !fs.existsSync(path.join(root, 'bench', 'out', 'ledger.jsonl')),
        'nothing was spent',
      );
      assert.ok(
        !fs.existsSync(path.join(root, 'bench', 'out', 'r1', 'answers')),
        'nothing was answered',
      );
      assert.equal(mode(path.dirname(started.log_file)), 0o700);
      assert.equal(mode(started.log_file), 0o600);
    } finally {
      // A job that did not end by itself is killed, so a failed test leaves nothing running.
      if (
        jobDir.processState(started.pid, JOB_SCRIPT) === jobDir.PROCESS_RUNNING
      )
        killJob(started.pid);
    }

    const bad = cli(['pairs', '--skills', `${SKILL};id`, '--root', root]);
    assert.equal(bad.status, 64, String(bad.error || bad.stderr));
    assert.match(
      JSON.parse(bad.stdout).error,
      /unknown skill\(s\) in --skills: brew-log;id/,
    );
  });
});
