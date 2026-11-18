// SPDX-License-Identifier: Apache-2.0
// The Kiro Crew workflow (scripts/bench/workflows/skill-benchmark.py) and the Quickstart shell loop of
// scripts/bench/README.md. The workflow runs against a stub ctx (workflow-stub.py) that answers every agent call with a
// canned reply and gives the script only the builtins the Crew sandbox allows, so no agent, model, AWS or network call
// is made. The shell loop runs with the stub provider on a copy of the fixture repo. Both need python3 or bash and
// skip without them; the source checks need neither.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const helpers = require('./helpers');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(
  REPO_ROOT,
  'scripts',
  'bench',
  'workflows',
  'skill-benchmark.py',
);
const STUB = path.join(__dirname, 'workflow-stub.py');
const README = path.join(REPO_ROOT, 'scripts', 'bench', 'README.md');
const SOURCE = fs.readFileSync(WORKFLOW, 'utf8');

const havePython = spawnSync('python3', ['--version']).status === 0;
const haveBash = spawnSync('bash', ['--version']).status === 0;
const needsPython = { skip: !havePython && 'python3 is not available' };
const needsBash = { skip: !haveBash && 'bash is not available' };

const REPO = '/work/repo';
const NOW = '2026-11-12T18:15:00.123456+00:00';
const STARTED_AT = '2026-11-12T18:15:00Z';
const START_EPOCH = Date.parse(STARTED_AT) / 1000;
const GOOD = { repo: REPO, skills: 'brew-log', run: 'r1' };
const LOG_FILE = `${REPO}/bench/out/r1/jobs/pairs.brew-log.log`;

const jobCommand = (
  job = 'pairs',
  maxUsd = '30.00',
  extra = [],
  skills = 'brew-log',
) => [
  'node',
  'scripts/bench/job.js',
  job,
  '--skills',
  skills,
  '--run',
  'r1',
  '--root',
  REPO,
  '--max-usd',
  maxUsd,
  ...extra,
];
const jobReply = (overrides = {}) => ({
  exit_code: 0,
  next: 'job',
  job: 'pairs',
  scale: '',
  pending: 16,
  estimated_usd: 1.25,
  estimated_minutes: 9,
  command: jobCommand(),
  status: '',
  kind: '',
  reason: '',
  error: '',
  ...overrides,
});
const DONE = {
  exit_code: 0,
  next: 'done',
  status: 'done',
  command: [],
  kind: '',
  reason: '',
};
const stopReply = (kind, reason) => ({
  exit_code: 1,
  next: 'stop',
  kind,
  reason,
  command: [],
});
const LAUNCHED = {
  exit_code: 0,
  pid: 4242,
  already_running: false,
  log_file: LOG_FILE,
  error: '',
};
const ENDED = { state: 'ended', status: 'done', exit_code: 0, stop: '' };
const REPORT = {
  exit_code: 0,
  report_md: `${REPO}/bench/out/r1/report.md`,
  report_json: `${REPO}/bench/out/r1/report.json`,
  controls_status: 'NONE',
  labels_published: true,
  labels: { 'brew-log': 'no change' },
  error: '',
};
const REPLIES = {
  next: [jobReply(), DONE],
  launch: LAUNCHED,
  wait: ENDED,
  report: REPORT,
};

/**
 * Runs the workflow on the stub ctx. Returns { result, calls, logs, phases, raised, labels, prompt(label) }.
 * `edit` changes the spec text before it is read, to write a number the way JSON.stringify never does (4242.0).
 */
function runWorkflow(args, replies = {}, now = NOW, edit = (text) => text) {
  const spec = { args, now, replies: { ...REPLIES, ...replies } };
  const ran = spawnSync(
    'python3',
    [STUB, WORKFLOW, edit(JSON.stringify(spec))],
    { encoding: 'utf8' },
  );
  assert.equal(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout);
  assert.equal(out.raised, '', out.raised);
  out.labels = out.calls.map((call) => call.label);
  out.prompt = (label) => {
    const call = out.calls.find((entry) => entry.label === label);
    assert.ok(call, `no call ${label} in ${out.labels.join(', ')}`);
    return call.prompt;
  };
  return out;
}

/** Calls one function of the workflow script (no agent, no run) and returns its value. */
function callWorkflow(name, args) {
  const spec = { call: { name, args } };
  const ran = spawnSync('python3', [STUB, WORKFLOW, JSON.stringify(spec)], {
    encoding: 'utf8',
  });
  assert.equal(ran.status, 0, ran.stderr);
  return JSON.parse(ran.stdout).value;
}

/** The one command line a prompt asks the agent to run (the line after "command:"). */
const commandOf = (prompt) => prompt.split('\n')[1];

// ---- the source -------------------------------------------------------------------------------------------------

test('the workflow source: SPDX line, META, the three inputs, the loop over next and report, the STOP text', () => {
  assert.equal(SOURCE.split('\n')[0], '# SPDX-License-Identifier: Apache-2.0');
  assert.match(SOURCE, /^META = \{\n {4}"name": "skill-benchmark",/m);
  assert.match(SOURCE, /"phases": \["inputs", "run", "report"\]/);
  assert.match(SOURCE, /^async def workflow\(ctx\):$/m);
  for (const input of ['skills', 'max_usd', 'max_minutes', 'repo', 'run'])
    assert.ok(SOURCE.includes(`args.get("${input}"`), input);
  assert.match(SOURCE, /node scripts\/bench\/bench\.js next --skills /);
  assert.match(SOURCE, /node scripts\/bench\/bench\.js report --skills /);
  assert.match(SOURCE, /node scripts\/bench\/launch\.js /);
  assert.match(SOURCE, /"STOP %s: %s"/);
});

test('the workflow source stays inside the Crew sandbox and under the workflow size limit', () => {
  assert.doesNotMatch(SOURCE, /^\s*(import|from)\s/m, 'no import');
  assert.doesNotMatch(SOURCE, /\.format(_map)?\(/, 'no str.format');
  assert.doesNotMatch(SOURCE, /\b(eval|exec|open|getattr|globals)\(/);
  assert.doesNotMatch(SOURCE, /\._[a-z]/, 'no private attribute');
  // Crew's validator refuses a script over 262,144 bytes (MAX_SCRIPT_BYTES); this bound only guards against growth; keep room for edits.
  assert.ok(Array.from(SOURCE).length < 48000);
});

test('the workflow source names no machine path, account id, profile, role or credential step', () => {
  assert.doesNotMatch(SOURCE, /\/Users\/|\/home\/|\/Volumes\//);
  assert.doesNotMatch(SOURCE, /\b\d{12}\b/);
  for (const word of [
    'opencode' + '-bench',
    'get_aws' + '_creds',
    'persist' + '-creds',
    'aws_' + 'account',
    'AWS_' + 'PROFILE',
    'export-' + 'credentials',
  ])
    assert.ok(!SOURCE.includes(word), word);
  assert.doesNotMatch(SOURCE, /\brole\b/i);
  assert.doesNotMatch(SOURCE, /[\u2013\u2014]/);
});

// ---- the loop ---------------------------------------------------------------------------------------------------

test(
  'a run: next names a job, the job is launched and waited for, next says done, then the report',
  needsPython,
  () => {
    const out = runWorkflow(GOOD);
    assert.deepEqual(out.labels, [
      'next:0',
      'launch:0:pairs',
      'wait:0:0',
      'next:1',
      'report',
    ]);
    assert.deepEqual(out.phases, ['inputs', 'run', 'report']);
    assert.equal(out.result.status, 'OK');
    assert.equal(
      out.result.reason,
      `controls NONE; labels brew-log: no change; report ${REPO}/bench/out/r1/report.md`,
    );
    assert.equal(out.result.passes, 2);
    assert.deepEqual(out.result.inputs, {
      repo: REPO,
      skills: ['brew-log'],
      max_usd: 30,
      max_minutes: 50,
      run: 'r1',
      provider: 'live',
      started_at: STARTED_AT,
    });
    assert.equal(
      commandOf(out.prompt('launch:0:pairs')),
      `cd ${REPO} && node scripts/bench/launch.js pairs --skills brew-log --run r1 --root ${REPO} --max-usd 30.00`,
    );
    assert.equal(
      commandOf(out.prompt('report')),
      `cd ${REPO} && node scripts/bench/bench.js report --skills brew-log --run r1`,
    );
    // Every agent call asks for structured fields, and every prompt carries the rules.
    for (const call of out.calls) {
      assert.equal(call.schema.type, 'object', call.label);
      assert.match(
        call.prompt,
        /Run only the command given, exactly as written/,
      );
    }
  },
);

test(
  'limit wiring: every next gets max_usd, max_minutes and the run start, with the defaults',
  needsPython,
  () => {
    const out = runWorkflow(GOOD);
    const expected = `cd ${REPO} && node scripts/bench/bench.js next --skills brew-log --run r1 --max-usd 30.00 --max-minutes 50 --started-at ${STARTED_AT}`;
    assert.equal(commandOf(out.prompt('next:0')), expected);
    assert.equal(commandOf(out.prompt('next:1')), expected);
  },
);

test(
  'limit wiring: max_usd and max_minutes inputs reach every next and the job, and nothing of the defaults is left',
  needsPython,
  () => {
    const out = runWorkflow(
      {
        ...GOOD,
        skills: ['brew-log', 'convention-control'],
        max_usd: 7.5,
        max_minutes: 30,
      },
      {
        next: [
          jobReply({
            command: jobCommand(
              'judge',
              '7.50',
              ['--scale', 'items'],
              'brew-log,convention-control',
            ),
            job: 'judge',
            scale: 'items',
          }),
          DONE,
        ],
      },
    );
    const next = commandOf(out.prompt('next:0'));
    assert.equal(
      next,
      `cd ${REPO} && node scripts/bench/bench.js next --skills brew-log,convention-control --run r1 --max-usd 7.50 --max-minutes 30 --started-at ${STARTED_AT}`,
    );
    assert.equal(commandOf(out.prompt('next:1')), next);
    assert.ok(!out.calls.some((call) => call.prompt.includes('30.00')));
    assert.ok(
      !out.calls.some((call) => call.prompt.includes('--max-minutes 50')),
    );
    assert.match(
      commandOf(out.prompt('launch:0:judge items')),
      / --max-usd 7\.50 --scale items$/,
    );
    // The wait never runs past the run start plus max_minutes.
    assert.ok(
      out.prompt('wait:0:0').includes(`-ge ${START_EPOCH + 30 * 60} ]`),
      out.prompt('wait:0:0'),
    );
  },
);

test(
  "limit wiring: a command from next without this run's --max-usd or --run is not started",
  needsPython,
  () => {
    for (const command of [
      jobCommand('pairs', '99.00'),
      jobCommand().map((arg) => (arg === 'r1' ? 'r2' : arg)),
    ]) {
      const out = runWorkflow(GOOD, { next: [jobReply({ command })] });
      assert.equal(out.result.status, 'FAILED');
      assert.match(out.result.reason, /without this run's --run and --max-usd/);
      assert.deepEqual(out.labels, ['next:0']);
    }
  },
);

test(
  'the run start comes from ctx.now, in each of its UTC forms',
  needsPython,
  () => {
    for (const now of [
      '2026-11-12T18:15:00Z',
      '2026-11-12T18:15:00+00:00',
      '2026-11-12T18:15:00.5Z',
    ]) {
      const out = runWorkflow(GOOD, {}, now);
      assert.match(
        commandOf(out.prompt('next:0')),
        / --started-at 2026-11-12T18:15:00Z$/,
      );
    }
    // A leap day and a year boundary, so the date arithmetic is checked against Date.parse.
    for (const stamp of ['2028-02-29T23:59:59Z', '2030-12-31T00:00:00Z']) {
      const out = runWorkflow({ ...GOOD, max_minutes: 1 }, {}, stamp);
      assert.ok(
        out
          .prompt('wait:0:0')
          .includes(`-ge ${Date.parse(stamp) / 1000 + 60} ]`),
      );
    }
    for (const now of [
      '',
      'yesterday',
      '2026-11-12T18:15:00-05:00',
      '2026-13-12T18:15:00Z',
      42,
    ]) {
      const out = runWorkflow(GOOD, {}, now);
      assert.equal(out.result.status, 'FAILED', String(now));
      assert.match(out.result.reason, /ctx\.now/);
      assert.equal(out.calls.length, 0);
    }
  },
);

test(
  'a spend stop from next prints STOP with the reason and still writes the report',
  needsPython,
  () => {
    const out = runWorkflow(GOOD, {
      next: [stopReply('spend', 'projected $31.20 is above max_usd $30.00')],
    });
    assert.equal(out.result.status, 'STOP');
    assert.equal(
      out.result.reason,
      'STOP spend: projected $31.20 is above max_usd $30.00',
    );
    assert.deepEqual(out.logs, [out.result.reason]);
    assert.deepEqual(out.labels, ['next:0', 'report']);
  },
);

test(
  'a time stop after a job ran prints STOP and ends RUNNING, so a rerun goes on',
  needsPython,
  () => {
    const reason =
      'max_minutes 50 is reached; finished work is kept, rerun to continue';
    const out = runWorkflow(GOOD, {
      next: [jobReply(), stopReply('time', reason)],
    });
    assert.equal(out.result.status, 'RUNNING');
    assert.equal(out.result.reason, `STOP time: ${reason}`);
    assert.deepEqual(out.logs, [out.result.reason]);
    assert.deepEqual(out.labels, [
      'next:0',
      'launch:0:pairs',
      'wait:0:0',
      'next:1',
      'report',
    ]);
  },
);

test(
  'a time stop before any job ran is a STOP, because a rerun would stop the same way',
  needsPython,
  () => {
    const reason =
      'the next job (pairs, 10 call(s)) needs about 6 minute(s) and 4 of max_minutes 5 are left; finished work is kept, rerun to continue';
    const out = runWorkflow(
      { ...GOOD, max_minutes: 5 },
      { next: [stopReply('time', reason)] },
    );
    assert.equal(out.result.status, 'STOP');
    assert.equal(
      out.result.reason,
      `STOP time: ${reason}; a rerun stops here again: raise max_minutes (at most 55) or run that job by hand`,
    );
    assert.deepEqual(out.logs, [out.result.reason]);
    assert.deepEqual(out.labels, ['next:0', 'report']);
  },
);

test('a refused stop is a STOP of kind refused', needsPython, () => {
  const out = runWorkflow(GOOD, {
    next: [stopReply('refused', 'brew-log: tasks-b1.json is not valid')],
  });
  assert.equal(out.result.status, 'STOP');
  assert.equal(
    out.result.reason,
    'STOP refused: brew-log: tasks-b1.json is not valid',
  );
});

test(
  'job exits: 3 is PARTIAL, 1 and 4 to 9 are a STOP, anything else is FAILED with no report',
  needsPython,
  () => {
    const partial = runWorkflow(GOOD, {
      wait: { ...ENDED, status: 'partial', exit_code: 3 },
    });
    assert.equal(partial.result.status, 'PARTIAL');
    assert.deepEqual(partial.labels, [
      'next:0',
      'launch:0:pairs',
      'wait:0:0',
      'report',
    ]);

    const kinds = {
      1: 'refused',
      4: 'credentials',
      5: 'spend',
      6: 'ledger',
      7: 'security',
      8: 'model',
      9: 'systemic',
      10: 'setup',
    };
    for (const [code, kind] of Object.entries(kinds)) {
      const out = runWorkflow(GOOD, {
        wait: {
          ...ENDED,
          status: 'stopped',
          exit_code: Number(code),
          stop: 'the reason',
        },
      });
      assert.equal(out.result.status, 'STOP', code);
      assert.equal(
        out.result.reason,
        `STOP ${kind}: pairs exited ${code}: the reason`,
      );
      assert.deepEqual(out.logs, [out.result.reason]);
      assert.equal(out.labels.at(-1), 'report');
    }

    for (const code of [70, 64, -1]) {
      const out = runWorkflow(GOOD, {
        wait: { ...ENDED, exit_code: code, stop: 'not json' },
      });
      assert.equal(out.result.status, 'FAILED', String(code));
      assert.ok(!out.labels.includes('report'));
    }
  },
);

test(
  'a long job: the workflow waits again while it runs, and ends RUNNING at the deadline',
  needsPython,
  () => {
    const twice = runWorkflow(GOOD, { wait: [{ state: 'RUNNING' }, ENDED] });
    assert.deepEqual(twice.labels, [
      'next:0',
      'launch:0:pairs',
      'wait:0:0',
      'wait:0:1',
      'next:1',
      'report',
    ]);
    assert.equal(twice.result.status, 'OK');

    const deadline = runWorkflow(GOOD, { wait: { state: 'DEADLINE' } });
    assert.equal(deadline.result.status, 'RUNNING');
    assert.match(
      deadline.result.reason,
      /still runs detached; rerun to continue/,
    );
    assert.deepEqual(deadline.labels, [
      'next:0',
      'launch:0:pairs',
      'wait:0:0',
      'report',
    ]);

    // A job that never ends is waited for a bounded number of times: max_minutes / 10 minutes, plus 2.
    const forever = runWorkflow(
      { ...GOOD, max_minutes: 20 },
      { wait: { state: 'RUNNING' } },
    );
    assert.equal(forever.result.status, 'RUNNING');
    assert.equal(
      forever.labels.filter((label) => label.startsWith('wait:')).length,
      4,
    );

    const garbled = runWorkflow(GOOD, { wait: { state: 'maybe' } });
    assert.equal(garbled.result.status, 'FAILED');
  },
);

test(
  'the wait command polls the job process and reads its last log line',
  needsPython,
  () => {
    const out = runWorkflow(GOOD);
    const command = commandOf(out.prompt('wait:0:0'));
    assert.ok(
      command.includes(
        'ps -p 4242 -o args= 2>/dev/null | grep -q scripts/bench/job.js',
      ),
    );
    assert.ok(command.includes('sleep 20'));
    assert.ok(command.includes('[ $i -lt 30 ]'));
    assert.ok(command.endsWith(`tail -n 1 ${LOG_FILE}; fi`));
  },
);

/** A process whose arguments hold scripts/bench/job.js, as the job's process does. Stopped by the caller. */
const startJobLike = () =>
  spawn('bash', ['-c', "exec -a 'node /x/scripts/bench/job.js' sleep 30"], {
    stdio: 'ignore',
  });

/** Runs the generated wait command in bash. Returns { out, ms }. */
function runWait(pid, logFile, deadline, waitSecs, pollSecs) {
  const command = callWorkflow('wait_command', [
    pid,
    logFile,
    deadline,
    waitSecs,
    pollSecs,
  ]);
  const started = Date.now();
  const ran = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(ran.status, 0, ran.stderr);
  return { out: ran.stdout.trim(), ms: Date.now() - started };
}

const nowSecs = () => Math.floor(Date.now() / 1000);

test(
  'the wait command, run in bash: DEADLINE or RUNNING while the job process lives, the last log line once it ended',
  {
    skip:
      (!havePython && 'python3 is not available') ||
      (!haveBash && 'bash is not available'),
  },
  () =>
    helpers.withTmp((dir) => {
      const logFile = path.join(dir, 'job.log');
      const lastLine = '{"status":"done","exit_code":0,"stop":null}';
      fs.writeFileSync(logFile, `starting\n${lastLine}\n`);
      const job = startJobLike();
      try {
        // The deadline has passed: stop waiting at once.
        const past = runWait(job.pid, logFile, nowSecs() - 5, 2, 1);
        assert.equal(past.out, 'DEADLINE');

        // The deadline is far: wait the whole bound, then say the job still runs.
        const far = runWait(job.pid, logFile, nowSecs() + 3600, 2, 1);
        assert.equal(far.out, 'RUNNING');
        assert.ok(far.ms >= 1500, `waited ${far.ms} ms`);

        // The deadline comes inside the bound: stop at the deadline, not at the end of the bound.
        const soon = runWait(job.pid, logFile, nowSecs() + 2, 30, 1);
        assert.equal(soon.out, 'DEADLINE');
        assert.ok(soon.ms < 15000, `waited ${soon.ms} ms`);
      } finally {
        job.kill();
      }

      // A pid that is gone: the last log line, even when the deadline has passed.
      const finished = spawnSync('true');
      const ended = runWait(finished.pid, logFile, nowSecs() - 5, 2, 1);
      assert.equal(ended.out, lastLine);

      // A live process that is not the job script (a reused pid) counts as ended.
      const other = spawn('sleep', ['30'], { stdio: 'ignore' });
      try {
        assert.equal(
          runWait(other.pid, logFile, nowSecs() + 3600, 2, 1).out,
          lastLine,
        );
      } finally {
        other.kill();
      }

      // A last line that is not JSON comes back as it is.
      fs.writeFileSync(logFile, 'starting\nnot json\n');
      assert.equal(
        runWait(finished.pid, logFile, nowSecs() + 3600, 2, 1).out,
        'not json',
      );
    }),
);

test(
  'a launch that fails (not a refusal), or gives no usable pid or log file, is FAILED before any wait',
  needsPython,
  () => {
    for (const launch of [
      { ...LAUNCHED, exit_code: 70, error: 'a bug in the benchmark' },
      { ...LAUNCHED, exit_code: 64, error: 'unknown skill(s) in --skills' },
      { ...LAUNCHED, exit_code: 2, error: 'a gate finding' },
      { ...LAUNCHED, exit_code: 74, error: 'cannot write the log' },
      { ...LAUNCHED, exit_code: 1.5, error: '' },
      { ...LAUNCHED, exit_code: -1 },
      { ...LAUNCHED, pid: 0 },
      { ...LAUNCHED, pid: 12.5 },
      { ...LAUNCHED, log_file: 'bench/out/r1/jobs/pairs.log' },
      { ...LAUNCHED, log_file: '/tmp/pairs.log' },
      { ...LAUNCHED, log_file: `${REPO}/bench/out/r1/jobs/x.log; rm x` },
      // Only a log in this run's jobs folder is read.
      { ...LAUNCHED, log_file: '/tmp/bench/out/x.log' },
      { ...LAUNCHED, log_file: '/etc/bench/out/passwd.log' },
      { ...LAUNCHED, log_file: `${REPO}/bench/out/r2/jobs/pairs.log` },
      { ...LAUNCHED, log_file: `${REPO}/bench/out/r1/other/pairs.log` },
      { ...LAUNCHED, log_file: `${REPO}/bench/out/r1/jobs/pairs.txt` },
    ]) {
      const out = runWorkflow(GOOD, { launch });
      assert.equal(out.result.status, 'FAILED', JSON.stringify(launch));
      assert.deepEqual(out.labels, ['next:0', 'launch:0:pairs']);
    }
    const already = runWorkflow(GOOD, {
      launch: { ...LAUNCHED, already_running: true },
    });
    assert.equal(already.result.status, 'OK');
  },
);

test(
  'a run whose control failed ends STOP with the labels withheld, and a stub run says its answers are made up',
  needsPython,
  () => {
    const failed = runWorkflow(GOOD, {
      report: {
        ...REPORT,
        controls_status: 'FAIL',
        labels_published: false,
        labels: { 'brew-log': 'withheld (controls: FAIL)' },
      },
    });
    assert.equal(failed.result.status, 'STOP');
    assert.equal(
      failed.result.reason,
      `STOP controls: controls FAIL; labels withheld, read ${REPORT.report_md}`,
    );
    assert.ok(!/brew-log/.test(failed.result.reason));
    assert.deepEqual(failed.logs, [failed.result.reason]);
    assert.equal(failed.result.report.controls_status, 'FAIL');
    const stub = runWorkflow(
      { ...GOOD, run: 'stub-try', provider: 'stub' },
      {
        launch: {
          ...LAUNCHED,
          log_file: LOG_FILE.replace('/r1/', '/stub-try/'),
        },
        next: [
          jobReply({
            command: jobCommand('pairs', '30.00', ['--provider', 'stub']).map(
              (arg) => (arg === 'r1' ? 'stub-try' : arg),
            ),
          }),
          DONE,
        ],
      },
    );
    assert.equal(stub.result.status, 'OK', JSON.stringify(stub.result));
    assert.match(
      stub.result.reason,
      /^stub run \(made-up answers\): controls /,
    );
  },
);

test(
  'the wait prompt asks for a tool timeout longer than the wait, and a run id with a dot is accepted',
  needsPython,
  () => {
    const out = runWorkflow(GOOD);
    assert.match(out.prompt('wait:0:0'), /at least 720000 ms/);
    assert.match(
      out.prompt('launch:0:pairs'),
      /does not have empty \(0 for a number\)/,
      'a refusal line has no pid, so the prompt says to leave it empty',
    );
    const dotted = runWorkflow({ ...GOOD, run: 'r1.2' });
    assert.equal(dotted.labels[0], 'next:0', 'the run id r1.2 is not refused');
  },
);

test(
  'a launch the launcher refuses (exit 1) is a STOP of kind refused with its reason, like a job that exits 1, and the report is still written',
  needsPython,
  () => {
    const reason =
      'a pairs job for brew-log is already running (pid 99, pairs.brew-log.pid); wait for it to end, or start other skills';
    const refused = runWorkflow(GOOD, {
      launch: { exit_code: 1, error: reason },
    });
    assert.equal(refused.result.status, 'STOP');
    assert.equal(
      refused.result.reason,
      `STOP refused: the launch of pairs was refused: ${reason}`,
    );
    assert.deepEqual(refused.logs, [refused.result.reason]);
    // Nothing was started, so there is nothing to wait for; the report still runs, as after a job's own exit 1.
    assert.deepEqual(refused.labels, ['next:0', 'launch:0:pairs', 'report']);
    assert.equal(refused.result.jobs.length, 1);
    assert.equal(
      refused.result.report.exit_code,
      0,
      'the report is in the result',
    );
    // It reads like the stop of a job that exited 1.
    const job = runWorkflow(GOOD, {
      wait: { ...ENDED, status: 'stopped', exit_code: 1, stop: 'the reason' },
    });
    assert.equal(job.result.status, 'STOP');
    assert.match(job.result.reason, /^STOP refused: /);
    // A judge job names its scale in the reason.
    const judge = runWorkflow(GOOD, {
      next: [
        jobReply({
          job: 'judge',
          scale: 'outcome',
          command: jobCommand('judge', '30.00', ['--scale', 'outcome']),
        }),
      ],
      launch: { exit_code: 1, error: 'another launch holds the lock' },
    });
    assert.equal(judge.result.status, 'STOP');
    assert.equal(
      judge.result.reason,
      'STOP refused: the launch of judge outcome was refused: another launch holds the lock',
    );
    // An exit 1 with no error line is not the launcher's refusal line, so it is not read as one.
    const bare = runWorkflow(GOOD, { launch: { exit_code: 1 } });
    assert.equal(bare.result.status, 'FAILED');
    assert.equal(bare.result.reason, 'the launch of pairs exited 1');
  },
);

test(
  'a launch that exits 1 but whose JSON line also holds a pid is still a refusal, and an exit 0 with an error is still FAILED',
  needsPython,
  () => {
    const refused = runWorkflow(GOOD, {
      launch: { ...LAUNCHED, exit_code: 1, error: 'refused' },
    });
    assert.equal(refused.result.status, 'STOP');
    assert.ok(!refused.labels.some((label) => label.startsWith('wait')));
    const failed = runWorkflow(GOOD, {
      launch: { ...LAUNCHED, error: 'something went wrong' },
    });
    assert.equal(failed.result.status, 'FAILED');
    assert.equal(failed.result.reason, 'something went wrong');
  },
);

test('a pid that comes back as 4242.0 is read as 4242', needsPython, () => {
  const edits = [];
  const out = runWorkflow(GOOD, {}, NOW, (text) => {
    const edited = text.replace('"pid":4242,', '"pid":4242.0,');
    edits.push(edited !== text);
    return edited;
  });
  assert.deepEqual(edits, [true]);
  assert.equal(out.result.status, 'OK');
  assert.ok(commandOf(out.prompt('wait:0:0')).includes('ps -p 4242 -o args='));
});

test(
  'a command next prints is run only when it is the job script with plain arguments',
  needsPython,
  () => {
    const bad = [
      [
        'node',
        'scripts/bench/other.js',
        'pairs',
        '--run',
        'r1',
        '--max-usd',
        '30.00',
      ],
      [
        'bash',
        'scripts/bench/job.js',
        'pairs',
        '--run',
        'r1',
        '--max-usd',
        '30.00',
      ],
      jobCommand('report'),
      jobCommand('pairs', '30.00', ['--skills', 'a;touch x']),
      jobCommand('pairs', '30.00', ['$(id)']),
      jobCommand('pairs', '30.00', ['a b']),
      [],
      'node scripts/bench/job.js pairs',
      ['node', 'scripts/bench/job.js'],
      [...jobCommand().slice(0, 3), '--skills'],
    ];
    for (const command of bad) {
      const out = runWorkflow(GOOD, { next: [jobReply({ command })] });
      assert.equal(out.result.status, 'FAILED', JSON.stringify(command));
      assert.deepEqual(out.labels, ['next:0'], JSON.stringify(command));
    }
    // The command must also be the job `next` named. Two replies: with the check gone the run would go on to
    // launch the pairs command and end `OK` at the second reply.
    const mismatch = runWorkflow(GOOD, {
      next: [jobReply({ job: 'judge' }), DONE],
    });
    assert.equal(mismatch.result.status, 'FAILED');
    assert.match(
      mismatch.result.reason,
      /not .node scripts\/bench\/job\.js judge/,
    );
    assert.deepEqual(mismatch.labels, ['next:0'], 'nothing was launched');
  },
);

test(
  'a stub run takes a job command with --provider stub, and a live run one without it',
  needsPython,
  () => {
    const forStub = (command) =>
      command.map((arg) => (arg === 'r1' ? 'stub-try' : arg));
    const stubArgs = { ...GOOD, run: 'stub-try', provider: 'stub' };
    const dropped = runWorkflow(stubArgs, {
      next: [jobReply({ command: forStub(jobCommand()) })],
    });
    assert.equal(dropped.result.status, 'FAILED');
    assert.match(
      dropped.result.reason,
      /whose --provider does not match this run's provider \(stub\)/,
    );
    assert.deepEqual(dropped.labels, ['next:0']);

    const added = runWorkflow(GOOD, {
      next: [
        jobReply({
          command: jobCommand('pairs', '30.00', ['--provider', 'stub']),
        }),
      ],
    });
    assert.equal(added.result.status, 'FAILED');
    assert.match(added.result.reason, /provider \(live\)/);
    assert.deepEqual(added.labels, ['next:0']);
  },
);

test(
  "a job command is run only with this run's skills, and the ladder form with the ladder's items",
  needsPython,
  () => {
    const ladder = ['--ladder', `${REPO}/bench/dose-ladder.json`];
    const named = (args, command) =>
      runWorkflow(args, {
        next: [jobReply({ command, job: command[2] }), DONE],
      });

    for (const skills of ['other-skill', 'brew-log,x-y', 'brew-log,brew-log']) {
      const out = named(GOOD, jobCommand('pairs', '30.00', [], skills));
      assert.equal(out.result.status, 'FAILED', skills);
      assert.match(out.result.reason, /--skills are not this run's skills/);
      assert.deepEqual(out.labels, ['next:0'], skills);
    }
    // A selected skill left out, and a skill list given twice or not at all.
    const left = named(
      { ...GOOD, skills: ['brew-log', 'convention-control'] },
      jobCommand(),
    );
    assert.equal(left.result.status, 'FAILED');
    const twice = named(
      GOOD,
      jobCommand('pairs', '30.00', ['--skills', 'brew-log']),
    );
    assert.match(twice.result.reason, /exactly one --skills list/);
    const none = named(
      GOOD,
      jobCommand().filter(
        (arg, i, all) => arg !== '--skills' && all[i - 1] !== '--skills',
      ),
    );
    assert.match(none.result.reason, /exactly one --skills list/);

    // The names may come in another order.
    const reordered = named(
      { ...GOOD, skills: ['convention-control', 'brew-log'] },
      jobCommand('pairs', '30.00', [], 'brew-log,convention-control'),
    );
    assert.equal(reordered.result.status, 'OK');

    // The ladder form: the selected skills plus the ladder's own items.
    const withLadder = named(
      { ...GOOD, skills: ['brew-log', 'dose-ladder'] },
      jobCommand('pairs', '30.00', ladder, 'brew-log,fixture-d0,fixture-d1'),
    );
    assert.equal(withLadder.result.status, 'OK');
    const ladderOnly = named(
      { ...GOOD, skills: 'dose-ladder' },
      jobCommand('pairs', '30.00', ladder, 'fixture-d0,fixture-d1'),
    );
    assert.equal(ladderOnly.result.status, 'OK');
    // A job without the ladder, in a run that selects it, names the plain skills only.
    const plainJob = named(
      { ...GOOD, skills: ['brew-log', 'dose-ladder'] },
      jobCommand('checklists'),
    );
    assert.equal(plainJob.result.status, 'OK');

    const noLadderSelected = named(
      GOOD,
      jobCommand('pairs', '30.00', ladder, 'brew-log,fixture-d0'),
    );
    assert.equal(noLadderSelected.result.status, 'FAILED');
    assert.match(noLadderSelected.result.reason, /--skills and --ladder/);
    const skillMissing = named(
      { ...GOOD, skills: ['brew-log', 'dose-ladder'] },
      jobCommand('pairs', '30.00', ladder, 'fixture-d0,fixture-d1'),
    );
    assert.equal(skillMissing.result.status, 'FAILED');
  },
);

test(
  'next that fails, or never says done, ends FAILED with no report',
  needsPython,
  () => {
    const usage = runWorkflow(GOOD, {
      next: [{ exit_code: 64, next: '', error: 'error: unknown skill nope' }],
    });
    assert.equal(usage.result.status, 'FAILED');
    assert.equal(
      usage.result.reason,
      '`next` failed: error: unknown skill nope',
    );
    assert.deepEqual(usage.labels, ['next:0']);

    const endless = runWorkflow(GOOD, { next: [jobReply()] });
    assert.equal(endless.result.status, 'FAILED');
    assert.match(endless.result.reason, /after 12 passes/);
    assert.equal(
      endless.labels.filter((label) => label.startsWith('next:')).length,
      12,
    );
    assert.ok(!endless.labels.includes('report'));
  },
);

test(
  'an exit code that does not match the next or job fields is FAILED, never a done, a stop or a job',
  needsPython,
  () => {
    const cases = [
      [
        'next done with exit 64',
        { next: [{ ...DONE, exit_code: 64 }] },
        ['next:0'],
      ],
      [
        'next stop with exit 0',
        { next: [{ ...stopReply('spend', 'x'), exit_code: 0 }] },
        ['next:0'],
      ],
      [
        'next job with exit 1',
        { next: [jobReply({ exit_code: 1 })] },
        ['next:0'],
      ],
      [
        'launch with exit 1 and no error',
        { launch: { ...LAUNCHED, exit_code: 1 } },
        ['next:0', 'launch:0:pairs'],
      ],
    ];
    for (const [name, replies, labels] of cases) {
      const out = runWorkflow(GOOD, replies);
      assert.equal(out.result.status, 'FAILED', name);
      assert.deepEqual(out.labels, labels, name);
    }
  },
);

test(
  'every agent call asks for the fields the workflow reads and carries the credential rules',
  needsPython,
  () => {
    const out = runWorkflow(GOOD);
    const expected = {
      'next:0': {
        required: ['exit_code', 'next'],
        types: {
          exit_code: 'number',
          next: 'string',
          kind: 'string',
          reason: 'string',
          job: 'string',
          scale: 'string',
          pending: 'number',
          estimated_usd: 'number',
          estimated_minutes: 'number',
          command: 'array',
          status: 'string',
          error: 'string',
        },
      },
      'launch:0:pairs': {
        required: ['exit_code'],
        types: {
          exit_code: 'number',
          pid: 'number',
          already_running: 'boolean',
          log_file: 'string',
          error: 'string',
        },
      },
      'wait:0:0': {
        required: ['state'],
        types: {
          state: 'string',
          status: 'string',
          exit_code: 'number',
          stop: 'string',
        },
      },
      report: {
        required: ['exit_code'],
        types: {
          exit_code: 'number',
          report_md: 'string',
          report_json: 'string',
          controls_status: 'string',
          labels_published: 'boolean',
          labels: 'object',
          error: 'string',
        },
      },
    };
    for (const [label, want] of Object.entries(expected)) {
      const call = out.calls.find((entry) => entry.label === label);
      assert.ok(call, label);
      assert.deepEqual(call.schema.required, want.required, label);
      const types = Object.fromEntries(
        Object.entries(call.schema.properties).map(([name, spec]) => [
          name,
          spec.type,
        ]),
      );
      assert.deepEqual(types, want.types, label);
    }
    const command = out.calls[0].schema.properties.command;
    assert.deepEqual(command, { type: 'array', items: { type: 'string' } });
    for (const call of out.calls) {
      assert.match(
        call.prompt,
        /Never print, copy or write a key, secret or session token/,
        call.label,
      );
      assert.match(
        call.prompt,
        /never run env, printenv or aws configure/,
        call.label,
      );
    }
  },
);

test(
  'done with a blocked judgment is PARTIAL and still writes the report',
  needsPython,
  () => {
    const out = runWorkflow(GOOD, { next: [{ ...DONE, status: 'partial' }] });
    assert.equal(out.result.status, 'PARTIAL');
    assert.deepEqual(out.labels, ['next:0', 'report']);
  },
);

test(
  'a report that fails after a stop, a deadline or a partial job is named in the reason',
  needsPython,
  () => {
    const failed = { exit_code: 64, error: 'error: no such run' };
    const stop = runWorkflow(GOOD, {
      next: [stopReply('spend', 'over the limit')],
      report: failed,
    });
    assert.equal(stop.result.status, 'STOP');
    assert.equal(
      stop.result.reason,
      'STOP spend: over the limit; the report failed: error: no such run',
    );
    assert.deepEqual(stop.logs, ['STOP spend: over the limit']);

    const partial = runWorkflow(GOOD, {
      wait: { ...ENDED, status: 'partial', exit_code: 3 },
      report: { exit_code: 0, report_md: '' },
    });
    assert.equal(partial.result.status, 'PARTIAL');
    assert.match(partial.result.reason, /; the report failed: no report file$/);

    const deadline = runWorkflow(GOOD, {
      wait: { state: 'DEADLINE' },
      report: failed,
    });
    assert.equal(deadline.result.status, 'RUNNING');
    assert.match(
      deadline.result.reason,
      /; the report failed: error: no such run$/,
    );
  },
);

test('a report that fails makes the run FAILED', needsPython, () => {
  const out = runWorkflow(GOOD, {
    report: { exit_code: 64, error: 'error: no such run' },
  });
  assert.equal(out.result.status, 'FAILED');
  assert.equal(out.result.reason, 'the report failed: error: no such run');
});

test(
  'the stub provider reaches next and report, and the launch prompt says no model is used',
  needsPython,
  () => {
    const out = runWorkflow(
      { ...GOOD, run: 'stub-try', provider: 'stub' },
      {
        next: [
          jobReply({
            command: jobCommand('pairs', '30.00', ['--provider', 'stub']).map(
              (arg) => (arg === 'r1' ? 'stub-try' : arg),
            ),
          }),
          DONE,
        ],
        launch: {
          ...LAUNCHED,
          log_file: LOG_FILE.replace('/r1/', '/stub-try/'),
        },
      },
    );
    assert.equal(out.result.status, 'OK');
    assert.match(commandOf(out.prompt('next:0')), / --provider stub$/);
    assert.match(
      commandOf(out.prompt('report')),
      / --run stub-try --provider stub$/,
    );
    assert.match(
      out.prompt('launch:0:pairs'),
      /^Uses no model \(stub provider\)\./,
    );
    const live = runWorkflow(GOOD);
    assert.match(live.prompt('launch:0:pairs'), /^PAID: about 1\.25 USD\./);
  },
);

test(
  'inputs: every bad value is FAILED before any agent call, naming the input',
  needsPython,
  () => {
    const cases = [
      [{ skills: 'brew-log' }, /`repo` is required/],
      [{ ...GOOD, repo: 'relative/repo' }, /`repo` is required/],
      [{ ...GOOD, repo: '/work/a b' }, /`repo`/],
      [{ ...GOOD, repo: '/work/$(id)' }, /`repo`/],
      [{ ...GOOD, repo: '/work/../etc' }, /`repo`/],
      [{ repo: REPO }, /`skills` is required/],
      [{ ...GOOD, skills: '' }, /`skills`/],
      [{ ...GOOD, skills: 'Brew-Log' }, /`skills`/],
      [{ ...GOOD, skills: 'brew-log,brew-log' }, /`skills`/],
      [{ ...GOOD, skills: 'a;b' }, /`skills`/],
      [{ ...GOOD, skills: ['brew-log', 3] }, /`skills`/],
      [{ ...GOOD, max_usd: 0 }, /`max_usd` must be a number above 0/],
      [{ ...GOOD, max_usd: '25' }, /`max_usd`/],
      [{ ...GOOD, max_usd: true }, /`max_usd`/],
      [{ ...GOOD, max_usd: 1.234 }, /at most 2 decimals/],
      [{ ...GOOD, max_minutes: 0 }, /`max_minutes`/],
      [
        { ...GOOD, max_minutes: 56 },
        /`max_minutes` must be a whole number from 1 to 55/,
      ],
      [{ ...GOOD, max_minutes: 1.5 }, /`max_minutes`/],
      [{ ...GOOD, max_minutes: '30' }, /`max_minutes`/],
      [{ ...GOOD, run: '../x' }, /`run`/],
      [{ ...GOOD, run: '.hidden' }, /`run`/],
      [{ ...GOOD, run: 'ledger.jsonl' }, /`run`/],
      [{ ...GOOD, provider: 'bedrock' }, /`provider` must be `live` or `stub`/],
      [{ ...GOOD, provider: 'stub' }, /stub needs a `run` named `stub`/],
      [
        { ...GOOD, run: 'stubby', provider: 'stub' },
        /stub needs a `run` named `stub`/,
      ],
      [{ ...GOOD, repo: '/work//repo' }, /`repo`/],
      [{ ...GOOD, repo: '/work/r\u00e9po' }, /`repo`/],
      [{ ...GOOD, run: 'r\u00e9' }, /`run`/],
      // A misspelt input name is refused, not ignored (it would fall back to a default limit).
      [
        { ...GOOD, maxUsd: 5 },
        /unknown input\(s\): maxUsd; the inputs are repo/,
      ],
      [{ ...GOOD, 'max-usd': 5 }, /unknown input\(s\): max-usd/],
      [
        { ...GOOD, max_usd_limit: 5, max_minutes_: 20 },
        /unknown input\(s\): max_minutes_, max_usd_limit/,
      ],
    ];
    for (const [args, reason] of cases) {
      const out = runWorkflow(args);
      assert.equal(out.result.status, 'FAILED', JSON.stringify(args));
      assert.match(out.result.reason, reason, JSON.stringify(args));
      assert.equal(out.calls.length, 0, JSON.stringify(args));
    }
    // The limits at their edges are accepted.
    for (const args of [
      { ...GOOD, max_usd: 0.01, max_minutes: 1 },
      {
        ...GOOD,
        max_usd: 100,
        max_minutes: 55,
        skills: ' brew-log , convention-control ',
      },
    ]) {
      const out = runWorkflow(args, { next: [DONE] });
      assert.equal(out.result.status, 'OK', JSON.stringify(args));
      assert.match(
        commandOf(out.prompt('next:0')),
        new RegExp(
          ` --max-usd ${args.max_usd.toFixed(2)} --max-minutes ${args.max_minutes} `,
        ),
      );
    }
  },
);

// ---- the Quickstart loop ------------------------------------------------------------------------------------------

/** The Quickstart loop from the README: the sh block that holds the `while` loop, with the list indent removed. */
function quickstartLoop() {
  const text = fs.readFileSync(README, 'utf8');
  const section = text.slice(text.indexOf('\n## Quickstart\n'));
  const blocks = [...section.matchAll(/\n {3}```sh\n([\s\S]*?)\n {3}```\n/g)];
  const loop = blocks
    .map((match) => match[1])
    .find((block) => block.includes('while LINE='));
  assert.ok(loop, 'the Quickstart has the loop');
  return loop
    .split('\n')
    .map((line) => line.replace(/^ {3}/, ''))
    .join('\n');
}

test('the Quickstart loop is about ten lines and runs next, the jobs and report', () => {
  const loop = quickstartLoop();
  const lines = loop.split('\n');
  assert.ok(lines.length <= 12, `${lines.length} lines`);
  assert.match(
    lines[0],
    /^SKILLS=\S+ RUN=\S+ MAX_USD=\S+ MAX_MINUTES=\S+ OPTS=$/,
  );
  assert.match(loop, /--max-usd "\$MAX_USD"/);
  assert.match(loop, /--max-minutes "\$MAX_MINUTES" --started-at "\$START"/);
  assert.match(loop, /echo "STOP \$LINE"/);
  assert.match(loop, /bench\.js report --skills "\$SKILLS" --run "\$RUN"/);
});

test(
  'the Quickstart loop, run with the stub provider on the fixture repo, goes to done and a written report',
  needsBash,
  () =>
    helpers.withTmp((dir) => {
      const root = path.join(dir, 'repo');
      fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
      const run = 'stub-quickstart';
      const script = quickstartLoop()
        .split('\n')
        .map((line, index) =>
          index === 0
            ? `SKILLS=${helpers.SKILL} RUN=${run} MAX_USD=25 MAX_MINUTES=60 OPTS="--root ${root} --provider stub"`
            : line,
        )
        .join('\n');
      const ran = spawnSync('bash', ['-c', script], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
        },
        timeout: 120000,
      });
      assert.equal(ran.status, 0, ran.stderr);
      const lines = ran.stdout.trim().split('\n');
      const jobs = lines
        .filter((line) => line.startsWith('{"next":"job"'))
        .map((line) => {
          const step = JSON.parse(line);
          return step.scale ? `${step.job} ${step.scale}` : step.job;
        });
      assert.deepEqual(jobs, [
        'pairs',
        'judge items',
        'checklists',
        'judge outcome',
      ]);
      assert.ok(lines.some((line) => line.startsWith('{"next":"done"')));
      assert.ok(!ran.stdout.includes('STOP'));
      const report = JSON.parse(lines.at(-1));
      assert.equal(report.report, 'written');
      assert.ok(
        fs.existsSync(path.join(root, 'bench', 'out', run, 'report.md')),
      );
    }),
);
