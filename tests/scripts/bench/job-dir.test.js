// SPDX-License-Identifier: Apache-2.0
// Tests for the private job folder (scripts/bench/lib/job-dir.js): folder and file modes, the per-job and per-skill
// log and pid names, the live-process check, kept logs and the launch lock. Temp folders only; no model or AWS call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const jobDir = require('../../../scripts/bench/lib/job-dir');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

const mode = (file) => fs.statSync(file).mode & 0o777;
/** A pid that no process has: above the largest pid Linux or macOS hands out. */
const DEAD_PID = 99999999;
const THIS_PROCESS = path.basename(process.execPath);

test('the job folder is created 0700, and an older folder with a looser mode is tightened', () => {
  helpers.withTmp((dir) => {
    const fresh = path.join(dir, 'a', 'jobs');
    assert.equal(jobDir.ensureJobDir(fresh), fresh);
    assert.equal(mode(fresh), 0o700);
    assert.equal(
      mode(path.dirname(fresh)),
      0o700,
      'a folder made on the way is private too',
    );
    const loose = path.join(dir, 'loose');
    fs.mkdirSync(loose, { mode: 0o755 });
    fs.chmodSync(loose, 0o755);
    jobDir.ensureJobDir(loose);
    assert.equal(mode(loose), 0o700);
  });
});

test('the job folder is inside the run folder under bench/out/, never in the shared /tmp', () => {
  const layout = createLayout({
    root: path.join(path.sep, 'work', 'repo'),
    runId: 'r1',
  });
  assert.equal(layout.jobsDir, path.join(layout.runDir, 'jobs'));
  assert.ok(layout.jobsDir.startsWith(layout.outDir + path.sep));
  const here = createLayout();
  assert.ok(here.jobsDir.startsWith(here.root + path.sep));
});

test('log and pid files are one per job and skill list; a dry run has files of its own', () => {
  const dir = path.join(path.sep, 'x', 'jobs');
  assert.equal(
    jobDir.logFile(dir, 'pairs', 'alpha'),
    path.join(dir, 'pairs.alpha.log'),
  );
  assert.equal(
    jobDir.pidFile(dir, 'pairs', 'alpha'),
    path.join(dir, 'pairs.alpha.pid'),
  );
  assert.equal(
    jobDir.pidFile(dir, 'pairs', 'alpha', { dryRun: true }),
    path.join(dir, 'pairs.alpha.dry-run.pid'),
  );
  assert.equal(
    jobDir.logFile(dir, 'pairs', 'alpha', { dryRun: true }),
    path.join(dir, 'pairs.alpha.dry-run.log'),
  );
  assert.notEqual(
    jobDir.pidFile(dir, 'judge', 'alpha'),
    jobDir.pidFile(dir, 'pairs', 'alpha'),
  );
  for (const bad of ['', 'Pairs', '../x', 'a.b', 'a/b', 7])
    assert.throws(
      () => jobDir.logFile(dir, bad, 'alpha'),
      /unsafe job name/,
      String(bad),
    );
});

test('jobKey: the same skills in any order give one key; repeats count once', () => {
  assert.equal(jobDir.jobKey(['brew-log']), 'brew-log');
  assert.equal(
    jobDir.jobKey(['pantry-note', 'brew-log']),
    'brew-log+pantry-note',
  );
  assert.equal(
    jobDir.jobKey(['brew-log', 'pantry-note', 'brew-log']),
    'brew-log+pantry-note',
  );
});

test('jobKey: a long list keeps three names, the count and a digest of the whole list', () => {
  const names = Array.from(
    { length: 9 },
    (_, index) => `skill-number-${index}`,
  );
  const key = jobDir.jobKey(names);
  assert.match(
    key,
    /^skill-number-0\+skill-number-1\+skill-number-2\+and-6-more-[0-9a-f]{8}$/,
  );
  assert.equal(jobDir.jobKey([...names].reverse()), key);
  const other = jobDir.jobKey([...names.slice(0, 8), 'skill-number-x']);
  assert.notEqual(other, key, 'a different list gets a different digest');
  assert.ok(
    jobDir.jobKey(['a'.repeat(32), 'b'.repeat(31)]).length <=
      jobDir.KEY_MAX_CHARS,
  );
});

test('names have a length limit: a job name of 32 characters and a skill name of 128', () => {
  const job32 = `a${'-'.repeat(31)}`;
  assert.equal(
    path.basename(jobDir.logFile('/d', job32, 'k')),
    `${job32}.k.log`,
  );
  assert.throws(
    () => jobDir.logFile('/d', `${job32}-`, 'k'),
    /unsafe job name/,
  );
  assert.ok(jobDir.jobKey(['a'.repeat(128)]).startsWith('a'.repeat(128)));
  assert.throws(() => jobDir.jobKey(['a'.repeat(129)]), /unsafe skill name/);
});

test('jobKey: refuses an empty list and any name that could change the file name', () => {
  assert.throws(() => jobDir.jobKey([]), /at least one skill/);
  assert.throws(() => jobDir.jobKey('brew-log'), /at least one skill/);
  for (const bad of ['', 'a+b', 'a.b', '../x', 'A', 'a/b', '-a', 5])
    assert.throws(
      () => jobDir.jobKey(['brew-log', bad]),
      /unsafe skill name/,
      String(bad),
    );
});

test('pid records are written 0600 in one step and read back; a broken record reads as none', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'pairs.alpha.pid');
    const record = { pid: 4242, job: 'pairs', skills: ['alpha'] };
    jobDir.writePidRecord(file, record);
    assert.equal(mode(file), 0o600);
    assert.deepEqual(jobDir.readPidRecord(file), record);
    assert.deepEqual(
      fs.readdirSync(dir),
      ['pairs.alpha.pid'],
      'no temporary file is left',
    );
    assert.equal(jobDir.readPidRecord(path.join(dir, 'missing.pid')), null);
    for (const broken of [
      '{',
      'null',
      '[]',
      '{"pid":"12","job":"pairs","skills":[]}',
      '{"pid":12,"skills":[]}',
      '{"pid":12,"job":"pairs"}',
      '{"pid":1.5,"job":"pairs","skills":[]}',
      '{"pid":null,"job":"pairs","skills":[]}',
    ]) {
      fs.writeFileSync(file, broken);
      assert.equal(jobDir.readPidRecord(file), null, broken);
    }
  });
});

const { RUNNING, NOT_RUNNING, UNVERIFIED } = {
  RUNNING: jobDir.PROCESS_RUNNING,
  NOT_RUNNING: jobDir.PROCESS_NOT_RUNNING,
  UNVERIFIED: jobDir.PROCESS_UNVERIFIED,
};
const gone = () => {
  throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
};
const alive = () => true;
const listing =
  (stdout, status = 0) =>
  () => ({ status, stdout });
/**
 * A /proc reader for pid 4242 that holds `commandLine` (NUL-separated, as the kernel gives it), or fails when it is
 * null. It refuses any other path.
 */
const procReader = (commandLine) => (file) => {
  assert.equal(file, '/proc/4242/cmdline');
  if (commandLine === null)
    throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
  return commandLine;
};

test('processState: dead pid, reused pid (other command), live match, and values that are not a pid', () => {
  assert.equal(jobDir.processState(DEAD_PID, 'job.js'), NOT_RUNNING);
  assert.equal(
    jobDir.processState(process.pid, 'definitely-not-this-process-xyz'),
    NOT_RUNNING,
  );
  assert.equal(jobDir.processState(process.pid, THIS_PROCESS), RUNNING);
  for (const notPid of ['12', 1, 0, -5, 1.5, null])
    assert.equal(
      jobDir.processState(notPid, THIS_PROCESS),
      NOT_RUNNING,
      String(notPid),
    );
  assert.equal(
    jobDir.processState(process.pid, ''),
    NOT_RUNNING,
    'an empty needle matches nothing',
  );
});

test('processState: a process of another user is checked by its command line', () => {
  const otherUser = () => {
    throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
  };
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: otherUser,
      runSync: listing('node /r/scripts/bench/job.js pairs\n'),
    }),
    RUNNING,
  );
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: otherUser,
      runSync: listing('/usr/bin/vim\n'),
    }),
    NOT_RUNNING,
  );
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: gone,
      runSync: listing('job.js'),
    }),
    NOT_RUNNING,
  );
});

test('processState: when ps cannot answer, /proc/<pid>/cmdline is read; with neither the process is unverified, not running', () => {
  const noPs = () => ({ error: new Error('spawn ps ENOENT'), status: null });
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: noPs,
      readFile: procReader('node\0/r/scripts/bench/job.js\0pairs\0'),
    }),
    RUNNING,
    'ps is missing: the kernel command line is used',
  );
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: noPs,
      readFile: procReader('sleep\u0000600\u0000'),
    }),
    NOT_RUNNING,
    'a reused pid is told apart without ps too',
  );
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: listing('', 1),
      readFile: procReader(''),
    }),
    NOT_RUNNING,
    'an empty command line (a zombie) is not the job',
  );
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: noPs,
      readFile: procReader(null),
    }),
    UNVERIFIED,
    'alive, and no way to read what it runs',
  );
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: listing('', 1),
      readFile: procReader(null),
    }),
    UNVERIFIED,
    'ps answered with nothing and /proc is missing',
  );
  let signals = 0;
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: () => {
        signals += 1;
        if (signals > 1) gone();
      },
      runSync: noPs,
      readFile: procReader(null),
    }),
    NOT_RUNNING,
    'a process that ended while it was being read is not running',
  );
});

test('processState: ps is asked for the whole command line of the pid, within a time limit', () => {
  const asked = [];
  jobDir.processState(4242, 'job.js', {
    kill: alive,
    runSync: (command, args, options) => {
      asked.push({ command, args, options });
      return { status: 0, stdout: 'node job.js\n' };
    },
  });
  assert.deepEqual(asked, [
    {
      command: 'ps',
      args: ['-ww', '-p', '4242', '-o', 'command='],
      options: { timeoutMs: 5000 },
    },
  ]);
});

test('processState: a ps that fails is not an answer even when it printed something; the arguments in /proc are told apart by a space', () => {
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: listing('node /r/scripts/bench/job.js\n', 1),
      readFile: procReader('sleep\u0000600\u0000'),
    }),
    NOT_RUNNING,
    'the /proc command line decides, not the output of a failed ps',
  );
  assert.equal(
    jobDir.processState(4242, 'one two', {
      kill: alive,
      runSync: listing('', 1),
      readFile: procReader('one\0two\0'),
    }),
    RUNNING,
  );
  assert.equal(
    jobDir.processState(4242, 'onetwo', {
      kill: alive,
      runSync: listing('', 1),
      readFile: procReader('one\0two\0'),
    }),
    NOT_RUNNING,
  );
});

test('processState: pid 1 and a pid that is not a whole number are never the job, whatever kill and the command line say', () => {
  const everythingMatches = {
    kill: alive,
    runSync: listing('node job.js\n'),
  };
  for (const pid of [1, 0, -1, 2.5, NaN, '4242'])
    assert.equal(
      jobDir.processState(pid, 'job.js', everythingMatches),
      NOT_RUNNING,
      String(pid),
    );
  assert.equal(jobDir.processState(2, 'job.js', everythingMatches), RUNNING);
});

test('processState: a ps that succeeds with no output is not an answer, /proc is read', () => {
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: listing('\n', 0),
      readFile: procReader('node\0/r/scripts/bench/job.js\0'),
    }),
    RUNNING,
  );
});

test('processState: the ps listing wins over /proc when it answers', () => {
  assert.equal(
    jobDir.processState(4242, 'job.js', {
      kill: alive,
      runSync: listing('node /r/scripts/bench/job.js\n'),
      readFile: () => {
        throw new Error('must not be read');
      },
    }),
    RUNNING,
  );
});

test('liveJobs: only live processes of the asked job kind; dead, broken and other-kind records are not live', () => {
  helpers.withTmp((dir) => {
    jobDir.writePidRecord(path.join(dir, 'pairs.a.pid'), {
      pid: process.pid,
      job: 'pairs',
      skills: ['a'],
    });
    jobDir.writePidRecord(path.join(dir, 'pairs.b.pid'), {
      pid: DEAD_PID,
      job: 'pairs',
      skills: ['b'],
    });
    jobDir.writePidRecord(path.join(dir, 'judge.a.pid'), {
      pid: process.pid,
      job: 'judge',
      skills: ['a'],
    });
    fs.writeFileSync(path.join(dir, 'pairs.c.pid'), 'not json');
    fs.writeFileSync(path.join(dir, 'pairs.a.log'), '');
    const live = jobDir.liveJobs(dir, 'pairs', THIS_PROCESS);
    assert.deepEqual(
      live.map((record) => [path.basename(record.file), record.skills]),
      [['pairs.a.pid', ['a']]],
    );
    assert.deepEqual(
      jobDir.liveJobs(dir, 'pairs', 'definitely-not-this-process-xyz'),
      [],
    );
    assert.deepEqual(
      jobDir.liveJobs(path.join(dir, 'missing'), 'pairs', THIS_PROCESS),
      [],
    );
  });
});

test('liveJobs: records are listed in file name order; an unsafe job name and a folder that cannot be read are errors', (context) => {
  helpers.withTmp((dir) => {
    for (const name of ['b', 'a', 'c'])
      jobDir.writePidRecord(path.join(dir, `pairs.${name}.pid`), {
        pid: process.pid,
        job: 'pairs',
        skills: [name],
      });
    const readdir = fs.readdirSync;
    context.mock.method(fs, 'readdirSync', (target, ...rest) =>
      readdir.call(fs, target, ...rest).reverse(),
    );
    assert.deepEqual(
      jobDir
        .liveJobs(dir, 'pairs', THIS_PROCESS)
        .map((record) => path.basename(record.file)),
      ['pairs.a.pid', 'pairs.b.pid', 'pairs.c.pid'],
    );
    assert.throws(
      () => jobDir.liveJobs(dir, '../pairs', THIS_PROCESS),
      /unsafe job name/,
    );
    const notAFolder = path.join(dir, 'pairs.a.pid');
    assert.throws(() => jobDir.liveJobs(notAFolder, 'pairs', THIS_PROCESS), {
      code: 'ENOTDIR',
    });
  });
});

test('liveJobs: a process that cannot be checked is listed with unverified: true', () => {
  helpers.withTmp((dir) => {
    jobDir.writePidRecord(path.join(dir, 'pairs.a.pid'), {
      pid: 4242,
      job: 'pairs',
      skills: ['a'],
    });
    const live = jobDir.liveJobs(dir, 'pairs', 'job.js', {
      kill: alive,
      runSync: () => ({ error: new Error('no ps'), status: null }),
      readFile: procReader(null),
    });
    assert.deepEqual(
      live.map((record) => [path.basename(record.file), record.unverified]),
      [['pairs.a.pid', true]],
    );
    const checked = jobDir.liveJobs(dir, 'pairs', 'job.js', {
      kill: alive,
      runSync: listing('node job.js\n'),
    });
    assert.equal(checked[0].unverified, undefined);
  });
});

test('setLogAside: the old log is renamed, never deleted or overwritten', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'pairs.a.log');
    assert.equal(jobDir.setLogAside(file), null);
    const when = new Date('2026-01-02T03:04:05.000Z');
    const kept = [];
    for (const text of ['first', 'second', 'third']) {
      fs.writeFileSync(file, text);
      fs.utimesSync(file, when, when);
      kept.push(jobDir.setLogAside(file));
    }
    assert.deepEqual(
      kept.map((name) => path.basename(name)),
      [
        'pairs.a.log.2026-01-02T03-04-05-000Z',
        'pairs.a.log.2026-01-02T03-04-05-000Z-2',
        'pairs.a.log.2026-01-02T03-04-05-000Z-3',
      ],
    );
    assert.deepEqual(
      kept.map((name) => fs.readFileSync(name, 'utf8')),
      ['first', 'second', 'third'],
    );
    assert.ok(!fs.existsSync(file));
    // Only a log that is not there is "no log": a path that cannot be read is an error.
    assert.throws(() => jobDir.setLogAside(path.join(kept[0], 'x')), {
      code: 'ENOTDIR',
    });
  });
});

test('withLaunchLock: holds the lock for the callback and removes it after, also when the callback throws', () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    const result = jobDir.withLaunchLock(dir, () => {
      assert.ok(fs.existsSync(lockFile));
      assert.equal(mode(lockFile), 0o600);
      return 'started';
    });
    assert.equal(result, 'started');
    assert.ok(!fs.existsSync(lockFile));
    assert.throws(
      () =>
        jobDir.withLaunchLock(dir, () => {
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.ok(!fs.existsSync(lockFile));
  });
});

test('withLaunchLock: a held lock makes a second launch wait, then give up and start nothing', () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'other-holder');
    let clock = fs.statSync(lockFile).mtimeMs;
    let ran = false;
    assert.throws(
      () =>
        jobDir.withLaunchLock(
          dir,
          () => {
            ran = true;
          },
          {
            now: () => clock,
            sleep: (ms) => {
              clock += ms;
            },
            staleMs: 60000,
            timeoutMs: 1000,
          },
        ),
      (error) =>
        error instanceof jobDir.LaunchLockError &&
        /nothing was started/.test(error.message),
    );
    assert.equal(ran, false);
    assert.equal(
      fs.readFileSync(lockFile, 'utf8'),
      'other-holder',
      'the other holder keeps its lock',
    );
  });
});

test('withLaunchLock: a lock left by a crashed launcher is broken once it is stale', () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    assert.equal(
      jobDir.withLaunchLock(dir, () => 'ran', { staleMs: 30000 }),
      'ran',
    );
    assert.ok(!fs.existsSync(lockFile));
  });
});

test('withLaunchLock: a stale lock is renamed to a unique name that is gone after the launch, never removed in place', (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    const renames = [];
    const rename = fs.renameSync;
    context.mock.method(fs, 'renameSync', (from, to) => {
      renames.push({ from, to });
      return rename.call(fs, from, to);
    });
    jobDir.withLaunchLock(dir, () => 'ran', { staleMs: 30000 });
    assert.equal(renames.length, 1);
    assert.equal(renames[0].from, lockFile);
    assert.match(renames[0].to, /launch\.lock\.stale-\d+-[0-9a-f]{16}$/);
    assert.deepEqual(
      fs.readdirSync(dir),
      [],
      'no lock and no renamed lock is left',
    );
  });
});

/**
 * Plays launcher A inside launcher B: B has read the stale lock, then A moves that lock away and creates its own fresh
 * lock, then B goes on. `afterStale` runs once, right after B's first look at the lock.
 */
function racingBreak(context, lockFile, afterStale) {
  const stat = fs.statSync;
  let done = false;
  context.mock.method(fs, 'statSync', (file, ...rest) => {
    const result = stat.call(fs, file, ...rest);
    if (file === lockFile && !done) {
      done = true;
      afterStale();
    }
    return result;
  });
}

test("withLaunchLock: a launcher that lost the race for a stale lock leaves the winner's fresh lock in place and starts nothing", (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    racingBreak(context, lockFile, () => {
      fs.renameSync(lockFile, `${lockFile}.stale-a`);
      fs.rmSync(`${lockFile}.stale-a`);
      fs.writeFileSync(lockFile, 'holder-a'); // A holds a fresh lock now
    });
    let ran = false;
    let clock = Date.now();
    assert.throws(
      () =>
        jobDir.withLaunchLock(
          dir,
          () => {
            ran = true;
          },
          {
            now: () => clock,
            sleep: (ms) => {
              clock += ms;
            },
            staleMs: 30000,
            timeoutMs: 500,
          },
        ),
      jobDir.LaunchLockError,
    );
    assert.equal(ran, false, 'B must not run while A holds the lock');
    assert.equal(fs.readFileSync(lockFile, 'utf8'), 'holder-a');
    assert.deepEqual(
      fs.readdirSync(dir),
      [jobDir.LAUNCH_LOCK],
      'the lock B moved aside is not left behind',
    );
  });
});

test('withLaunchLock: when the lock cannot be linked back because a third launcher made one, the launch goes on with the new lock', (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    racingBreak(context, lockFile, () => {
      fs.rmSync(lockFile);
      fs.writeFileSync(lockFile, 'holder-a');
    });
    context.mock.method(fs, 'linkSync', () => {
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    });
    assert.equal(
      jobDir.withLaunchLock(dir, () => 'ran', { staleMs: 30000 }),
      'ran',
    );
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('withLaunchLock: an error other than "the lock exists" when the lock is linked back is thrown, and the moved lock is not left behind', (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    racingBreak(context, lockFile, () => {
      fs.rmSync(lockFile);
      fs.writeFileSync(lockFile, 'holder-a');
    });
    context.mock.method(fs, 'linkSync', () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    assert.throws(
      () => jobDir.withLaunchLock(dir, () => 'ran', { staleMs: 30000 }),
      { code: 'EACCES' },
    );
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('withLaunchLock: a stale lock that another launcher already moved away is simply gone, and the launch takes the lock', (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    racingBreak(context, lockFile, () => fs.rmSync(lockFile));
    assert.equal(
      jobDir.withLaunchLock(dir, () => 'ran', { staleMs: 30000 }),
      'ran',
    );
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('withLaunchLock: a moved lock that is exactly as old as the stale limit is not stale, and is linked back', () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'holder-a');
    const modified = new Date(1700000000000);
    fs.utimesSync(lockFile, modified, modified);
    const base = modified.getTime();
    // Calls of now(): the start, the age check (30001 ms, stale), the age check after the rename (30000 ms, not stale).
    const times = [base, base + 30001, base + 30000];
    assert.throws(
      () =>
        jobDir.withLaunchLock(dir, () => 'ran', {
          now: () => (times.length ? times.shift() : base + 30000),
          staleMs: 30000,
          timeoutMs: 100,
          sleep: () => {},
        }),
      jobDir.LaunchLockError,
    );
    assert.equal(fs.readFileSync(lockFile, 'utf8'), 'holder-a');
    assert.deepEqual(fs.readdirSync(dir), [jobDir.LAUNCH_LOCK]);
  });
});

test('withLaunchLock: a rename that fails for a reason other than "no such file" is thrown', (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockFile, old, old);
    context.mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    assert.throws(
      () => jobDir.withLaunchLock(dir, () => 'ran', { staleMs: 30000 }),
      { code: 'EACCES' },
    );
    assert.equal(fs.readFileSync(lockFile, 'utf8'), 'crashed-holder');
  });
});

test("withLaunchLock: a holder whose lock was taken over does not remove the new holder's lock", () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    jobDir.withLaunchLock(dir, () => {
      fs.rmSync(lockFile);
      fs.writeFileSync(lockFile, 'new-holder');
    });
    assert.equal(fs.readFileSync(lockFile, 'utf8'), 'new-holder');
  });
});

test('jobKey: a list of exactly 64 characters is its own key; one more character is cut to three names and a digest', () => {
  const names = (lengths) =>
    lengths.map((length, index) =>
      String.fromCharCode(97 + index).repeat(length),
    );
  const exact = names([20, 20, 21]); // 20 + 1 + 20 + 1 + 21 = 63
  assert.equal(jobDir.jobKey(exact).length, 63);
  const sixtyFour = names([20, 20, 22]);
  assert.equal(jobDir.jobKey(sixtyFour), sixtyFour.join('+'));
  assert.equal(jobDir.jobKey(sixtyFour).length, jobDir.KEY_MAX_CHARS);
  const sixtyFive = names([20, 20, 23]);
  assert.match(
    jobDir.jobKey(sixtyFive),
    /^a{20}\+b{20}\+c{23}\+and-0-more-[0-9a-f]{8}$/,
  );
});

test('writePidRecord: the record becomes visible in one rename of a complete temporary file', (context) => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'pairs.alpha.pid');
    const record = { pid: 4242, job: 'pairs', skills: ['alpha'] };
    const renames = [];
    const rename = fs.renameSync;
    context.mock.method(fs, 'renameSync', (from, to) => {
      renames.push({
        from,
        to,
        targetThere: fs.existsSync(to),
        text: fs.readFileSync(from, 'utf8'),
      });
      return rename.call(fs, from, to);
    });
    jobDir.writePidRecord(file, record);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].to, file);
    assert.equal(
      renames[0].targetThere,
      false,
      'nothing partial under the final name',
    );
    assert.deepEqual(
      JSON.parse(renames[0].text),
      record,
      'the temporary file is complete',
    );
  });
});

test('writePidRecord: a failed rename leaves no temporary file and no record, and the error is thrown', (context) => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'pairs.alpha.pid');
    context.mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    assert.throws(
      () => jobDir.writePidRecord(file, { pid: 1, job: 'pairs', skills: [] }),
      /disk full/,
    );
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('withLaunchLock: an error other than "the lock exists" is thrown at once, not retried', () => {
  helpers.withTmp((dir) => {
    assert.throws(
      () => jobDir.withLaunchLock(path.join(dir, 'missing'), () => 'ran'),
      { code: 'ENOENT' },
    );
  });
});

test('withLaunchLock: an unreadable lock file is thrown, while one that vanished is simply taken', (context) => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'other-holder');
    const stat = fs.statSync;
    context.mock.method(fs, 'statSync', (file, ...rest) => {
      if (file === lockFile)
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return stat.call(fs, file, ...rest);
    });
    assert.throws(() => jobDir.withLaunchLock(dir, () => 'ran'), {
      code: 'EACCES',
    });
    context.mock.restoreAll();
    context.mock.method(fs, 'statSync', (file, ...rest) => {
      if (file === lockFile) {
        fs.rmSync(lockFile);
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      }
      return stat.call(fs, file, ...rest);
    });
    assert.equal(
      jobDir.withLaunchLock(dir, () => 'ran'),
      'ran',
    );
  });
});

test('withLaunchLock: by default a held lock is waited for 10 seconds, in steps of 50 ms, then the launch gives up', () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'other-holder');
    let clock = fs.statSync(lockFile).mtimeMs;
    const started = clock;
    const sleeps = [];
    assert.throws(
      () =>
        jobDir.withLaunchLock(dir, () => 'ran', {
          now: () => clock,
          sleep: (ms) => {
            sleeps.push(ms);
            clock += ms;
          },
        }),
      jobDir.LaunchLockError,
    );
    assert.equal(clock - started, 10000);
    assert.ok(sleeps.every((ms) => ms === 50));
    assert.equal(sleeps.length, 200);
  });
});

test('withLaunchLock: by default a lock is stale only when it is older than 30 seconds', () => {
  helpers.withTmp((dir) => {
    const lockFile = path.join(dir, jobDir.LAUNCH_LOCK);
    fs.writeFileSync(lockFile, 'crashed-holder');
    const modified = new Date(1700000000000);
    fs.utimesSync(lockFile, modified, modified);
    let clock = modified.getTime() + 30000;
    let sleeps = 0;
    assert.equal(
      jobDir.withLaunchLock(dir, () => 'ran', {
        now: () => clock,
        sleep: (ms) => {
          sleeps += 1;
          clock += ms;
        },
      }),
      'ran',
    );
    assert.equal(sleeps, 1, 'exactly 30 s old is not stale yet; 30.05 s is');
  });
});

test('withLaunchLock: the lock file descriptor is closed, also when the callback throws', (context) => {
  helpers.withTmp((dir) => {
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
    jobDir.withLaunchLock(dir, () => 'ran');
    assert.throws(
      () =>
        jobDir.withLaunchLock(dir, () => {
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.equal(opened.size, 0, 'every descriptor that was opened is closed');
  });
});
