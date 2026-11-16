// SPDX-License-Identifier: Apache-2.0
// Tests for the job entry point (scripts/bench/job.js): the options it accepts, the exit code of every result and
// stop of the pairs job, the last JSON line, and redaction of what it prints. No model and no AWS call: the per-task
// runner is a stub, and everything is written to a copy of the fixture repo in a temp folder.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const job = require('../../../scripts/bench/job');
const {
  CredentialError,
} = require('../../../scripts/bench/lib/aws-credentials');
const { SecurityStopError } = require('../../../scripts/bench/lib/claude-run');
const { REPO_ROOT } = require('../../../scripts/bench/lib/layout');
const {
  LedgerError,
  SpendStopError,
} = require('../../../scripts/bench/lib/ledger');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;
const MODEL = helpers.exampleConfig().models.subject;
const JOB_JS = path.join(REPO_ROOT, 'scripts', 'bench', 'job.js');
const SUBJECT_RUNS = 10;

/** A runSubjectTask outcome with the fields the answer record reads. */
function outcome(status, { models = [MODEL] } = {}) {
  return {
    status,
    tries: [{ status }],
    result: {
      text: status === 'ok' ? 'Water at 80 C, two minutes.' : null,
      problems: [],
      modelsUsed: models,
      tools: ['Skill'],
      skillLoad: { loaded: status === 'ok' },
      usage: { input_tokens: 10, output_tokens: 5 },
      reportedUsd: 0,
      trace: { tool_calls: [], cli_version: '9.9.9-fixture' },
      toolErrors: [],
      permissionDenials: [],
      sweepWarning: null,
      error: null,
      ms: 1,
    },
  };
}

/**
 * Runs job.main on a copy of the fixture repo with `runTask` as the per-task runner. `prepare(root)` may change the
 * copy before the job starts. Returns
 * { code, out, err, last, root }, where `last` is the parsed last line of the output (or null).
 */
async function runJob(argv, runTask, { prepare = () => {}, env = {} } = {}) {
  return helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    prepare(root);
    const armsTmpRoot = path.join(dir, 'arms');
    fs.mkdirSync(armsTmpRoot, { mode: 0o700 });
    let out = '';
    let err = '';
    const code = await job.main(
      argv.map((word) => (word === '<root>' ? root : word)),
      { out: (text) => (out += text), err: (text) => (err += text) },
      {
        env,
        pairsOptions: { runTask, skillsVersion: 'fixture-commit', armsTmpRoot },
      },
    );
    const lines = out.trim().split('\n');
    let last = null;
    try {
      last = JSON.parse(lines.at(-1));
    } catch {
      last = null;
    }
    const answers = path.join(root, 'bench', 'out', 'default', 'answers');
    return {
      code,
      out,
      err,
      last,
      answerCount: fs.existsSync(answers)
        ? fs
            .readdirSync(answers, { recursive: true })
            .filter((name) => name.endsWith('.json')).length
        : 0,
    };
  });
}

const PAIRS = ['pairs', '--skills', SKILL, '--root', '<root>'];

test('exit codes: done and dry run 0, refused 1, partial 3, and one code per stop kind; 2 is never used', () => {
  assert.equal(job.exitCodeFor({ status: 'done' }), 0);
  assert.equal(job.exitCodeFor({ status: 'dry-run' }), 0);
  assert.equal(job.exitCodeFor({ status: 'refused' }), 1);
  assert.equal(job.exitCodeFor({ status: 'partial' }), 3);
  const expected = {
    credentials: 4,
    spend: 5,
    ledger: 6,
    security: 7,
    model: 8,
    systemic: 9,
    setup: 10,
  };
  assert.deepEqual({ ...job.STOP_EXIT_CODES }, expected);
  for (const [kind, code] of Object.entries(expected))
    assert.equal(
      job.exitCodeFor({ status: 'stopped', stop: { kind, message: 'x' } }),
      code,
    );
  assert.ok(!Object.values(job.STOP_EXIT_CODES).includes(2));
  assert.equal(new Set(Object.values(job.STOP_EXIT_CODES)).size, 7);
  assert.throws(
    () => job.exitCodeFor({ status: 'stopped', stop: { kind: 'other' } }),
    /unknown result/,
  );
  assert.throws(() => job.exitCodeFor({ status: 'later' }), /unknown result/);
});

test('job main: every pending run answered is done, exit 0, with the counts on the last line', async () => {
  let calls = 0;
  const result = await runJob(PAIRS, async () => {
    calls += 1;
    return outcome('ok');
  });
  assert.equal(result.code, 0, result.err);
  assert.equal(calls, SUBJECT_RUNS);
  assert.equal(result.answerCount, SUBJECT_RUNS);
  assert.deepEqual(result.last, {
    job: 'pairs',
    run_id: 'default',
    skills: [SKILL],
    status: 'done',
    exit_code: 0,
    stop: null,
    jobs: SUBJECT_RUNS,
    pending: SUBJECT_RUNS,
    results: { ok: SUBJECT_RUNS },
    skipped: [],
  });
  assert.match(result.out, /^pairs: run default, skills brew-log, pid \d+\n/);
  assert.match(result.out, /\nwarning: exclusions\.json: /);
});

test('job main: a run that is not loaded or fails makes the job partial, exit 3; the other answers are kept', async () => {
  let calls = 0;
  const result = await runJob(PAIRS, async () => {
    calls += 1;
    if (calls === 2) return outcome('not_loaded');
    if (calls === 3) return outcome('failed');
    return outcome('ok');
  });
  assert.equal(result.code, 3);
  assert.equal(result.last.status, 'partial');
  assert.deepEqual(result.last.results, { ok: 8, not_loaded: 1, failed: 1 });
  assert.equal(
    result.answerCount,
    9,
    'the not-loaded record is kept, the failed run writes nothing',
  );
});

test('job main: a ledger error that carries a quarantine ends the job as a security stop, exit 7, and names the copy', async () => {
  const copy = 'raw.jsonl~quarantined-2026-01-15T10-00-00-000Z';
  const error = Object.assign(
    new LedgerError('ledger write failed: no space'),
    {
      traceQuarantine: {
        quarantined: copy,
        note: `SECURITY STOP: a value the run knows is secret is in text the run returned: the answer text (literal x1). The raw log is quarantined as ${copy}. The matching text is not shown.`,
      },
    },
  );
  let calls = 0;
  const result = await runJob(PAIRS, async () => {
    calls += 1;
    throw error;
  });
  assert.equal(result.code, 7, result.err);
  assert.equal(calls, 1, 'no run starts after the stop');
  assert.equal(result.last.status, 'stopped');
  assert.equal(result.last.stop.kind, 'security');
  assert.ok(result.last.stop.message.includes(copy));
  assert.match(
    result.out,
    new RegExp(
      `\\nSTOP \\(security\\): SECURITY STOP: .*${copy}.* The run also ended with: ledger write failed: no space\\n`,
    ),
  );
  // The same error without the quarantine is still a ledger stop, exit 6.
  const plain = await runJob(PAIRS, async () => {
    throw new LedgerError('ledger write failed: no space');
  });
  assert.equal(plain.code, 6);
  assert.equal(plain.last.stop.kind, 'ledger');
});

test('job main: each stop ends the job with its own exit code and names the stop', async () => {
  const stops = [
    [new CredentialError('credentials expire in 1 minute'), 'credentials', 4],
    [new SpendStopError('total_cap_usd reached', 'total_cap_usd'), 'spend', 5],
    [new LedgerError('cannot read the ledger'), 'ledger', 6],
    [new SecurityStopError('the canary was found', {}), 'security', 7],
  ];
  for (const [error, kind, code] of stops) {
    let calls = 0;
    const result = await runJob(PAIRS, async () => {
      calls += 1;
      throw error;
    });
    assert.equal(result.code, code, kind);
    assert.equal(calls, 1, `${kind}: no run starts after the stop`);
    assert.equal(result.last.status, 'stopped');
    assert.equal(result.last.stop.kind, kind);
    assert.match(result.out, new RegExp(`\\nSTOP \\(${kind}\\): `));
    assert.equal(result.answerCount, 0);
  }
  const wrongModel = await runJob(PAIRS, async () =>
    outcome('ok', { models: ['some-other-model'] }),
  );
  assert.equal(wrongModel.code, 8);
  assert.equal(wrongModel.last.stop.kind, 'model');
  assert.equal(wrongModel.last.results.skipped, SUBJECT_RUNS - 1);
  // A first run that the subject model answered but that is invalid for another reason is a setup stop, not a model stop.
  const setupFault = await runJob(PAIRS, async () => {
    const answer = outcome('failed');
    answer.tries = [
      {
        status: 'failed',
        ok: true,
        valid: false,
        problems: ['the result event reports no model usage'],
      },
    ];
    return answer;
  });
  assert.equal(setupFault.code, 10, setupFault.err);
  assert.equal(setupFault.last.stop.kind, 'setup');
  assert.match(
    setupFault.out,
    /\nSTOP \(setup\): the first run was invalid for a reason that is not the skill: the result event reports no model usage\n/,
  );
  assert.equal(setupFault.last.results.skipped, SUBJECT_RUNS - 1);
  assert.equal(setupFault.answerCount, 0);
});

test('job main: skills that plan does not plan are named on the last line, and that line is printed whole', async () => {
  // 300 skills with no baseline make the `skipped` list longer than the 8000 characters a printed line is cut to.
  const extra = Array.from(
    { length: 300 },
    (_, index) => `no-baseline-${index}`,
  );
  const prepare = (root) => {
    for (const name of extra) {
      fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), '# x\n');
    }
  };
  const result = await runJob(
    ['pairs', '--skills', `${SKILL},${extra.join(',')}`, '--root', '<root>'],
    async () => outcome('ok'),
    { prepare },
  );
  assert.equal(result.code, 0, result.err);
  assert.ok(result.last, 'the last line is one JSON object');
  assert.ok(result.out.trim().split('\n').at(-1).length > 8000);
  assert.equal(result.last.skipped.length, extra.length);
  assert.deepEqual(result.last.skipped[0], {
    skill: 'no-baseline-0',
    status: 'no baseline',
  });
  assert.equal(result.last.results.ok, SUBJECT_RUNS);
});

test('job main: a plan that refuses the skills is exit 1, prints why, and runs nothing', async () => {
  let calls = 0;
  const result = await runJob([...PAIRS, '--max-usd', '0.01'], async () => {
    calls += 1;
    return outcome('ok');
  });
  assert.equal(result.code, 1);
  assert.equal(calls, 0);
  assert.equal(result.last.status, 'refused');
  assert.match(result.out, /\nrefused: .*max_usd/);
});

test('job main: --dry-run lists the runs, exit 0, and runs nothing', async () => {
  let calls = 0;
  const result = await runJob([...PAIRS, '--dry-run'], async () => {
    calls += 1;
    return outcome('ok');
  });
  assert.equal(result.code, 0);
  assert.equal(calls, 0);
  assert.equal(result.last.status, 'dry-run');
  assert.equal(result.out.match(/\n {2}would run /g).length, SUBJECT_RUNS);
  assert.match(
    result.out,
    /^pairs: run default, skills brew-log, dry run, pid \d+\n/,
  );
});

test('job main: usage errors are exit 64 and run nothing', async () => {
  const never = async () => {
    throw new Error('must not run');
  };
  for (const [argv, pattern] of [
    [['pairs', '--root', '<root>'], /--skills is required/],
    [['judge', '--skills', SKILL, '--root', '<root>'], /unknown job "judge"/],
    [[...PAIRS, '--json'], /unknown option --json/],
    [[...PAIRS, '--dry-run=1'], /--dry-run does not take a value/],
    [['--skills', SKILL], /first word must be a job name/],
  ]) {
    const result = await runJob(argv, never);
    assert.equal(result.code, 64, argv.join(' '));
    assert.match(result.err, pattern);
  }
  const help = await runJob(['--help'], never);
  assert.equal(help.code, 0);
  assert.match(help.out, /^Usage: node scripts\/bench\/job\.js <job>/);
});

test('job main: a bug is exit 70, and secret-shaped text in what is printed is redacted', async () => {
  const secret = 'AKIA' + 'EXAMPLEFIXTURE12';
  const result = await runJob(PAIRS, async () => {
    throw new Error(`unexpected ${secret}`);
  });
  assert.equal(result.code, 70);
  assert.match(
    result.err,
    /internal error, this is a bug in the benchmark: unexpected \[REDACTED_AWS_KEY_ID\]/,
  );
  assert.ok(!result.err.includes(secret));
  assert.ok(!result.out.includes(secret));
});

test('job main: --help after other flags prints the usage and runs nothing', async () => {
  const result = await runJob([...PAIRS, '--help'], async () => {
    throw new Error('must not run');
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /^Usage: node scripts\/bench\/job\.js <job>/);
});

test('job main: the stack of a bug is printed only with BENCH_DEBUG=1, and redacted', async () => {
  const secret = 'AKIA' + 'EXAMPLEFIXTURE12';
  const runTask = async () => {
    throw new Error(`unexpected ${secret}`);
  };
  const quiet = await runJob(PAIRS, runTask);
  assert.doesNotMatch(quiet.err, /\n\s+at /);
  assert.match(quiet.err, /Set BENCH_DEBUG=1 to print the stack trace/);
  const debug = await runJob(PAIRS, runTask, { env: { BENCH_DEBUG: '1' } });
  assert.equal(debug.code, 70);
  assert.match(debug.err, /\n\s+at /);
  assert.doesNotMatch(debug.err, /Set BENCH_DEBUG/);
  assert.match(debug.err, /unexpected \[REDACTED_AWS_KEY_ID\]/);
  assert.ok(!debug.err.includes(secret));
});

test('job main: secret-shaped text in a log line, a warning and a stop message is redacted on stdout', async () => {
  const secret = 'AKIA' + 'EXAMPLEFIXTURE12';
  // An exclusion that names no task makes plan warn with its id, so the id carries the secret into a warning line.
  const prepare = (root) => {
    const file = path.join(root, 'bench', 'exclusions.json');
    const exclusions = JSON.parse(fs.readFileSync(file, 'utf8'));
    exclusions.batches.b1.scenarios.push({
      id: secret,
      scales: ['outcome'],
      reason: 'fixture: an id shaped like a credential, to test redaction',
      date: '2026-01-16',
    });
    fs.writeFileSync(file, `${JSON.stringify(exclusions, null, 2)}\n`);
  };
  // The first run names a wrong model that carries the secret (the model stop message) and an error (its log line).
  const runTask = async () => {
    const answer = outcome('ok', { models: [`model-${secret}`] });
    answer.result.error = `upstream said ${secret}`;
    return answer;
  };
  const result = await runJob(PAIRS, runTask, { prepare });
  assert.equal(result.code, 8, result.err);
  assert.ok(!result.out.includes(secret), result.out);
  assert.match(
    result.out,
    /\nwarning: exclusions\.json: .*"\[REDACTED_AWS_KEY_ID\]" names no task/,
  );
  assert.match(
    result.out,
    /\n {2}\S+ ok .* error: upstream said \[REDACTED_AWS_KEY_ID\]\n/,
  );
  assert.match(
    result.out,
    /\nSTOP \(model\): the first run was answered by \["model-\[REDACTED_AWS_KEY_ID\]"\]/,
  );
  assert.match(result.last.stop.message, /model-\[REDACTED_AWS_KEY_ID\]/);
});

test('job CLI: the real entry point runs a dry run on the fixture and sets its exit code', () => {
  helpers.withTmp((dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const env = { PATH: process.env.PATH || '' };
    // A job that does not end by itself is killed, so the test fails instead of waiting for ever.
    const limits = {
      encoding: 'utf8',
      env,
      timeout: 60000,
      killSignal: 'SIGKILL',
    };
    const dry = spawnSync(
      process.execPath,
      [JOB_JS, 'pairs', '--skills', SKILL, '--root', root, '--dry-run'],
      limits,
    );
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(
      JSON.parse(dry.stdout.trim().split('\n').at(-1)).status,
      'dry-run',
    );
    const usage = spawnSync(
      process.execPath,
      [JOB_JS, 'pairs', '--root', root],
      limits,
    );
    assert.equal(usage.status, 64);
    assert.match(usage.stderr, /^error: --skills is required/);
  });
});
