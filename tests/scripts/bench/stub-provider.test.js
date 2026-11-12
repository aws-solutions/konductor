// SPDX-License-Identifier: Apache-2.0
// Tests for the stub provider (scripts/bench/lib/stub-provider.js) and the --provider option of job.js and the
// launcher: which run ids may hold stub data, what the stub claude and opencode answer, and that no other process can
// be started through it. No real process, model or AWS call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const job = require('../../../scripts/bench/job');
const launchLib = require('../../../scripts/bench/lib/launch');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { scoreJudgment } = require('../../../scripts/bench/lib/judge-scale');
const stub = require('../../../scripts/bench/lib/stub-provider');
const helpers = require('./helpers');

const capture = () => {
  const io = { text: '', errors: '' };
  io.out = (text) => {
    io.text += text;
  };
  io.err = (text) => {
    io.errors += text;
  };
  return io;
};

test('assertStubRun allows only the run id stub and ids that start with stub-', () => {
  for (const runId of ['stub', 'stub-a', 'stub-e2e-2']) {
    assert.doesNotThrow(() => stub.assertStubRun(runId), runId);
    assert.equal(stub.isStubRun(runId), true, runId);
  }
  for (const runId of [
    'default',
    'stubby',
    'my-stub',
    'Stub-a',
    'STUB',
    '',
    'r1',
  ])
    assert.throws(
      () => stub.assertStubRun(runId),
      /runs only in a run whose id is "stub"/,
      runId,
    );
  for (const runId of ['default', 'stubby', 'my-stub', '', 'r1'])
    assert.equal(stub.isStubRun(runId), false, runId);
  // A case-insensitive file system makes `STUB` the folder of `stub`, so a live job refuses these too.
  for (const runId of ['STUB', 'Stub', 'Stub-a', 'sTuB-q'])
    assert.equal(stub.isStubRun(runId), true, runId);
});

test('the stub process answers claude and opencode only; any other command is refused', async () => {
  for (const command of ['aws', 'git', '/bin/sh', 'node'])
    await assert.rejects(
      () => stub.stubProcess(command, ['--version'], {}),
      /the stub provider runs no/,
      command,
    );
  const version = await stub.stubProcess('/usr/local/bin/opencode', [
    '--version',
  ]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout, `${stub.STUB_VERSION}\n`);
  await assert.rejects(
    () => stub.stubProcess('opencode', ['session', 'export']),
    /unexpected command/,
  );
});

test('the stub subject loads the skill only in the with arm and answers in full only there', () =>
  helpers.withTmpAsync(async (dir) => {
    for (const arm of ['with', 'without']) {
      fs.mkdirSync(path.join(dir, arm, 'skills', 'other'), { recursive: true });
    }
    fs.mkdirSync(path.join(dir, 'with', 'skills', 'brew-log'));
    const request = 'Log my morning sencha brew.';
    const stdin = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: request }] },
    });
    const traceOf = async (arm) => {
      const result = await stub.stubProcess(
        'claude',
        ['--model', 'model-x', '--plugin-dir', path.join(dir, arm)],
        { stdin },
      );
      return result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    };
    const withTrace = await traceOf('with');
    const skillCall = withTrace.find((event) => event.type === 'assistant');
    assert.deepEqual(skillCall.message.content[0].input, {
      skill: 'bench:brew-log',
    });
    const withResult = withTrace[withTrace.length - 1];
    assert.equal(withResult.result, stub.subjectAnswer(request, 'with'));
    assert.ok(withResult.result.includes(stub.FULL_ANSWER_MARK));
    assert.deepEqual(Object.keys(withResult.modelUsage), ['model-x']);

    const withoutTrace = await traceOf('without');
    assert.equal(
      withoutTrace.some((event) => JSON.stringify(event).includes('tool_use')),
      false,
      'the without arm loads nothing',
    );
    const withoutResult = withoutTrace[withoutTrace.length - 1].result;
    assert.equal(withoutResult.includes(stub.FULL_ANSWER_MARK), false);
    assert.equal(
      withoutResult.slice(0, 15),
      withResult.result.slice(0, 15),
      'both answers carry the same request tag',
    );

    // Two skills only in the with arm: the stub cannot tell which is under test.
    fs.mkdirSync(path.join(dir, 'with', 'skills', 'pantry-note'));
    await assert.rejects(() => traceOf('with'), /expected one skill/);
  }));

test('the stub writer returns the item count it is asked for; the stub judge prefers the full answer', () => {
  const writer = JSON.parse(
    stub.replyTo(
      '=== REQUEST ===\nLog a brew.\n=== END OF REQUEST ===\n\nWrite 6 checklist items.\n',
    ),
  );
  assert.equal(writer.items.length, 6);
  assert.ok(writer.items.every((item) => item.length >= 12));

  const prompt = (answer) =>
    [
      '=== REQUEST ===',
      'Log a brew.',
      '',
      '=== CHECKLIST (score each item separately; the numbering is fixed) ===',
      '1. Gives the water temperature.',
      '2. Gives the steep time.',
      '3. Names the tea.',
      '',
      '<<<ANSWER id=m1>>>',
      answer,
      '<<<END_ANSWER id=m1>>>',
    ].join('\n');
  const full = `Reply 1: ${stub.FULL_ANSWER_MARK}.`;
  const short = 'Reply 1: a short reply.';
  const shortReply = JSON.parse(stub.replyTo(prompt(short)));
  const fullReply = JSON.parse(stub.replyTo(prompt(full)));
  assert.deepEqual(shortReply.items, ['MET', 'MISSING', 'MISSING']);
  assert.deepEqual(fullReply.items, ['MET', 'MET', 'MET']);
  for (const [arm, reply] of [
    ['without', shortReply],
    ['with', fullReply],
  ]) {
    const scored = scoreJudgment({
      scale: 'outcome',
      text: JSON.stringify(reply),
      arm,
      itemCount: 3,
    });
    assert.equal(scored.valid, true, scored.invalid);
    assert.equal(scored.arm, arm);
  }
  assert.throws(() => stub.replyTo('hello'), /neither a writer nor a judge/);
});

test('--provider: live by default outside a stub run, stub only in a stub run, and passed on to the job command', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const options = { skills: helpers.SKILL, root };
    const live = launchLib.resolveJobRequest('pairs', options);
    assert.equal(live.provider, 'live');
    assert.equal(
      launchLib.jobArguments(live, { dryRun: false }).includes('--provider'),
      false,
    );
    const stubbed = launchLib.resolveJobRequest('judge', {
      ...options,
      run: 'stub-x',
      scale: 'items',
      provider: 'stub',
    });
    assert.deepEqual(
      launchLib.jobArguments(stubbed, { dryRun: true }).slice(-3),
      ['--provider', 'stub', '--dry-run'],
    );
    assert.throws(
      () =>
        launchLib.resolveJobRequest('pairs', { ...options, provider: 'stub' }),
      /only in a run whose id is "stub"/,
    );
    // A stub run id takes only the stub: the live provider, given or by default, would read the stub's answers,
    // checklists and judgments as current and build a real report on them.
    for (const run of ['stub', 'stub-x', 'stub-e2e-2', 'STUB', 'Stub-q'])
      for (const given of [{}, { provider: 'live' }])
        assert.throws(
          () =>
            launchLib.resolveJobRequest('pairs', { ...options, run, ...given }),
          /is a stub run.*takes --provider stub only/,
          `${run} ${JSON.stringify(given)}`,
        );
    for (const run of ['stubby', 'my-stub', 'default'])
      assert.equal(
        launchLib.resolveJobRequest('pairs', { ...options, run }).provider,
        'live',
        run,
      );
    assert.throws(
      () =>
        launchLib.resolveJobRequest('pairs', {
          ...options,
          run: 'stub-x',
          provider: 'bedrock',
        }),
      /--provider must be one of live, stub/,
    );

    const io = capture();
    const code = await job.main(
      [
        'pairs',
        '--skills',
        helpers.SKILL,
        '--root',
        root,
        '--provider',
        'stub',
      ],
      io,
    );
    assert.equal(code, 64);
    assert.match(io.errors, /only in a run whose id is "stub"/);
    assert.equal(
      fs.existsSync(path.join(root, 'bench', 'out')),
      false,
      'a refused stub job writes nothing',
    );

    // The same job with no --provider in a stub run is refused too, a dry run included, and writes nothing.
    for (const extra of [[], ['--dry-run'], ['--provider', 'live']]) {
      const liveIo = capture();
      const liveCode = await job.main(
        [
          'pairs',
          '--skills',
          helpers.SKILL,
          '--root',
          root,
          '--run',
          'stub-x',
          ...extra,
        ],
        liveIo,
      );
      assert.equal(liveCode, 64, extra.join(' '));
      assert.match(liveIo.errors, /takes --provider stub only/);
    }
    assert.equal(fs.existsSync(path.join(root, 'bench', 'out')), false);
  }));

test('a stub pairs job through job.js writes answers that name the stub version and books its cost', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const io = capture();
    const code = await job.main(
      [
        'pairs',
        '--skills',
        helpers.SKILL,
        '--root',
        root,
        '--run',
        'stub-pairs',
        '--provider',
        'stub',
      ],
      io,
    );
    assert.equal(code, 0, io.text + io.errors);
    assert.match(io.text, /stub provider/);
    const record = helpers.readJson(
      path.join(
        root,
        'bench',
        'out',
        'stub-pairs',
        'answers',
        helpers.SKILL,
        'b1',
        `${helpers.SKILL}-rules-1.with.json`,
      ),
    );
    assert.equal(record.status, 'ok');
    assert.equal(record.claude_code_version, stub.STUB_VERSION);
    assert.equal(record.skills_version, stub.STUB_VERSION);
    assert.equal(record.skill_load.loaded, true);
    const ledger = fs.readFileSync(
      path.join(root, 'bench', 'out', 'stub-pairs', 'ledger.jsonl'),
      'utf8',
    );
    assert.equal(ledger.match(/"type":"settle"/g).length, 10);
    assert.equal(
      fs.existsSync(path.join(root, 'bench', 'out', 'ledger.jsonl')),
      false,
      'stub dollars never reach the shared ledger of real runs',
    );
  }));

test('a stub run keeps its own ledger in its run folder; a live run uses the shared one', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const outDir = path.join(root, 'bench', 'out');
    const live = launchLib.resolveJobRequest('pairs', {
      skills: helpers.SKILL,
      root,
      run: 'x',
    });
    assert.equal(live.layout.ledgerFile, path.join(outDir, 'ledger.jsonl'));
    const stubbed = launchLib.resolveJobRequest('pairs', {
      skills: helpers.SKILL,
      root,
      run: 'stub-x',
      provider: 'stub',
    });
    assert.equal(
      stubbed.layout.ledgerFile,
      path.join(outDir, 'stub-x', 'ledger.jsonl'),
    );
    const plain = createLayout({ root, runId: 'stub-x' });
    assert.equal(stubbed.layout.runDir, plain.runDir);
    assert.equal(
      stubbed.layout.answerFile(helpers.SKILL, 'b1', 't1', 'with'),
      plain.answerFile(helpers.SKILL, 'b1', 't1', 'with'),
    );
    assert.throws(
      () => stub.stubLayout(createLayout({ root, runId: 'r1' })),
      /only in a run whose id is "stub"/,
    );
  }));
