// SPDX-License-Identifier: Apache-2.0
// Tests for the judge job (scripts/bench/lib/judge-job.js) and its entry points (job.js judge, the launcher): what
// is planned for each reading, what a judge is shown, the judgment records and their provenance, resume, waits for
// answers and checklists, answers that are not loaded or not eligible, refusals, stops and dry runs. The judge call
// is a stub and the answers are written straight into a copy of the fixture repo in a temp folder: no process is
// started, no model and no AWS call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const job = require('../../../scripts/bench/job');
const checklistJob = require('../../../scripts/bench/lib/checklist-job');
const {
  loadConfig,
  judgeConcurrency,
} = require('../../../scripts/bench/lib/config');
const judgeJob = require('../../../scripts/bench/lib/judge-job');
const { createJudgeInput } = require('../../../scripts/bench/lib/judge-input');
const { judgeFor } = require('../../../scripts/bench/lib/judge-prompt');

const { createLayout } = require('../../../scripts/bench/lib/layout');
const launchLib = require('../../../scripts/bench/lib/launch');
const { MAX_PROMPT_BYTES } = require('../../../scripts/bench/lib/opencode');
const {
  LedgerError,
  SpendStopError,
  readLedger,
} = require('../../../scripts/bench/lib/ledger');
const {
  RUNNABLE_STATUSES,
  writeRecord,
} = require('../../../scripts/bench/lib/pairs');
const { buildPlan } = require('../../../scripts/bench/lib/plan');
const { redact } = require('../../../scripts/bench/lib/redact');
const { sha256 } = require('../../../scripts/bench/lib/provenance');
const { loadTaskSet } = require('../../../scripts/bench/lib/tasks');
const helpers = require('./helpers');
const { callCost } = require('../../../scripts/bench/lib/cost-profile');

const SKILL = helpers.SKILL;
const EXCLUDED = 'brew-log-rules-3';
const SEATS = ['anthropic', 'openai', 'xai'];
/** The cost profile prices of the example judge seats: a pending judgment is projected at its seat model's p90. */
const SEAT_PRICES = Object.fromEntries(
  SEATS.map((seat) => [
    seat,
    callCost(
      helpers.exampleConfig(),
      'judge',
      helpers.exampleConfig().models.judges[seat],
    ),
  ]),
);
/** The p90 of one judgment per seat. */
const P90_PER_SEAT_ROUND = SEATS.reduce(
  (total, seat) => total + SEAT_PRICES[seat].p90,
  0,
);
const roundUsd = (usd) => Number(usd.toFixed(4));
const TASKS = [1, 2, 3, 4, 5].map((n) => `${SKILL}-rules-${n}`);
const NOW_MS = Date.parse('2026-11-10T12:00:00Z');
const FRESH = {
  accessKeyId: 'fixture-key',
  secretAccessKey: 'fixture-secret',
  sessionToken: 'fixture-token',
  expiration: '2026-11-10T13:00:00Z',
};
// The with answer names "grassy"; the stub judge scores it higher wherever it is shown.
const WITH_TEXT =
  'Brew log: green sencha at 80 C for two minutes, grassy and sweet, a clean finish.';
const WITHOUT_TEXT = 'Brew log: tea with hot water for a while, then drunk.';
const ANSWER_BLOCK =
  /<<<ANSWER id=([A-Za-z0-9_-]+)>>>\n([\s\S]*?)\n<<<END_ANSWER id=\1>>>/;

/** What a judge prompt shows: the request, the numbered checklist and the one answer. */
function readPrompt(prompt) {
  const request = /=== REQUEST ===\n([\s\S]*?)\n\n=== CHECKLIST/.exec(
    prompt,
  )[1];
  const checklist = /=== CHECKLIST[^\n]*\n([\s\S]*?)\n\n<<<ANSWER /
    .exec(prompt)[1]
    .split('\n')
    .map((line) => line.replace(/^\d+\. /, ''));
  return { request, checklist, answer: ANSWER_BLOCK.exec(prompt)[2] };
}

/** A valid reply: every item MET for the answer that names "grassy", only the first item MET for any other. */
function labelsReply(prompt) {
  const shown = readPrompt(prompt);
  const better = shown.answer.includes('grassy');
  return JSON.stringify({
    items: shown.checklist.map((_, index) =>
      better || index === 0 ? 'MET' : 'MISSING',
    ),
    reason: 'item 2 decided the labels',
  });
}
const okResult = (text) => ({
  ok: true,
  text,
  usage: { input_tokens: 1000, output_tokens: 100 },
  usageSource: 'stream',
  reportedUsd: 0.005,
  ms: 3,
  error: null,
  stderr: '',
});
const failedResult = (error) => ({
  ok: false,
  text: '',
  usage: null,
  usageSource: 'none',
  reportedUsd: null,
  ms: 2,
  error,
  stderr: '',
});

/** A judgeCall stub that records every call and answers with `answer(args, index)` (default: labelsReply). */
function stubJudge(answer) {
  const calls = [];
  let live = 0;
  const maxLive = {};
  const judgeCall = async (args) => {
    if (args.credentialGuard) args.credentialGuard.assertFresh(args.label);
    calls.push(args);
    const seat = args.label.split(':')[2];
    live += 1;
    maxLive[seat] = Math.max(maxLive[seat] || 0, live);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      if (answer) return await answer(args, calls.length - 1);
      return okResult(labelsReply(args.prompt));
    } finally {
      live -= 1;
    }
  };
  return { calls, judgeCall, maxLive };
}

/** Writes a current answer record for every task and arm of the fixture skill; `text(arm, taskId)` may return null to skip one. */
function writeAnswers(
  layout,
  config,
  tmpRoot,
  text = (arm) => (arm === 'with' ? WITH_TEXT : WITHOUT_TEXT),
) {
  const { taskSet } = loadTaskSet({ layout, config, skill: SKILL, tmpRoot });
  for (const { batch, tasks } of taskSet.batches)
    for (const task of tasks)
      for (const arm of ['with', 'without']) {
        const answer = text(arm, task.id);
        if (answer === null) continue;
        writeAnswer(layout, { batch, task, arm, text: answer });
      }
  return taskSet;
}
function writeAnswer(
  layout,
  { batch, task, arm, text, status = 'ok', inputs },
) {
  const file = layout.answerFile(SKILL, batch, task.id, arm);
  writeRecord(file, {
    kind: 'answer',
    skill: SKILL,
    batch,
    task_id: task.id,
    arm,
    status,
    valid: status === 'ok',
    arm_blinding_version: 1,
    inputs: inputs || task.inputs[arm],
    answer_sha256: status === 'ok' ? sha256(text) : null,
    text: status === 'ok' ? text : null,
  });
  return file;
}

/** Runs callback({ dir, layout, config, tmpRoot, run }) on a copy of the fixture repo with current answers. */
async function withRepo(callback, { answers = true, config: overrides } = {}) {
  return helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const layout = createLayout({ root });
    const tmpRoot = path.join(dir, 'tmp');
    fs.mkdirSync(tmpRoot, { mode: 0o700 });
    const config = loadConfig({ defaultFile: layout.configFile, overrides });
    if (answers) writeAnswers(layout, config, tmpRoot);
    const run = (stub, options = {}) =>
      judgeJob.runJudging({
        layout,
        config,
        skills: [SKILL],
        scale: 'items',
        judgeCall: stub.judgeCall,
        readVersion: async () => '1.2.3-fixture',
        getCredentials: async () => FRESH,
        now: () => NOW_MS,
        armsTmpRoot: tmpRoot,
        retry: { sleep: async () => {}, baseMs: 0 },
        ...options,
      });
    return callback({ dir, layout, config, tmpRoot, run });
  });
}

/** Writes a current request-only checklist for every task read by A, through the checklist job with a stub writer. */
async function writeChecklists(layout, config) {
  const reply = (args) => {
    const count = Number(
      /^Write exactly (\d+) checklist items\.$/m.exec(args.prompt)[1],
    );
    return okResult(
      JSON.stringify({
        items: Array.from(
          { length: count },
          (_, index) =>
            `The entry gives requested detail number ${index + 1} of this brew.`,
        ),
      }),
    );
  };
  const summary = await checklistJob.runChecklists({
    layout,
    config,
    skills: [SKILL],
    judgeCall: async (args) => reply(args),
    getCredentials: async () => FRESH,
    now: () => NOW_MS,
    writer: { sleep: async () => {}, delayMs: () => 0 },
  });
  assert.equal(summary.status, 'done', JSON.stringify(summary));
}

const judgmentFiles = (layout, scale) => {
  const dir = path.join(layout.runDir, 'judgments', scale);
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .map(String)
        .filter((name) => /\.json$/.test(name))
        .sort()
    : [];
};
const keptFiles = (layout, scale, mark) => {
  const dir = path.join(layout.runDir, 'judgments', scale);
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .map(String)
        .filter((name) => name.includes(mark))
    : [];
};
const judgmentOf = (layout, scale, taskId, seat, arm = 'with') =>
  helpers.readJson(layout.judgmentFile(scale, SKILL, 'b1', taskId, seat, arm));

// ---- the happy path ------------------------------------------------------------------------------------------------

test('a rules checklist item that is edited makes the judgments of its task pending again, and no other task', () =>
  withRepo(async ({ layout, run }) => {
    await run(stubJudge());
    const file = path.join(
      layout.root,
      'bench',
      'baselines',
      SKILL,
      'tasks-b1.json',
    );
    const tasks = helpers.readJson(file);
    tasks.scenarios[0].rubric[0] = `${tasks.scenarios[0].rubric[0]} Edited.`;
    helpers.write(file, tasks);
    const stub = stubJudge();
    await run(stub);
    assert.equal(stub.calls.length, 6, 'three seats, both arms, one task');
    assert.ok(stub.calls.every((call) => call.label.includes(TASKS[0])));
  }));

test('a bucket sidecar edit that moves items between buckets makes their judgments pending again; the other tasks stay current', () =>
  withRepo(async ({ layout, run }) => {
    await run(stubJudge());
    const file = path.join(
      layout.root,
      'bench',
      'baselines',
      SKILL,
      'tasks-b1.buckets.json',
    );
    const sidecar = helpers.readJson(file);
    const entries = sidecar.scenarios[TASKS[0]];
    [entries['1'], entries['4']] = [entries['4'], entries['1']];
    assert.notEqual(entries['1'].bucket, entries['4'].bucket);
    helpers.write(file, sidecar);
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(stub.calls.length, 6, 'three seats, both arms, one task');
    assert.ok(
      stub.calls.every((call) => call.label.includes(TASKS[0])),
      'only the task whose sidecar changed',
    );
    const stored = judgmentOf(layout, 'items', TASKS[0], 'openai', 'without');
    assert.deepEqual(
      stored.guard,
      { items: 1, met: 1 },
      'the guard item is now item 1, which this answer meets',
    );
  }));

test('a judgment that cannot be saved stops the seats from starting more paid calls and is thrown as the write error', (context) =>
  withRepo(async ({ layout, config, run }) => {
    if (process.getuid && process.getuid() === 0) {
      context.skip('a root user can write to a read-only folder');
      return;
    }
    const folder = path.join(layout.runDir, 'judgments');
    fs.mkdirSync(folder, { recursive: true });
    fs.chmodSync(folder, 0o500);
    try {
      const stub = stubJudge();
      await assert.rejects(run(stub), (error) => error.code === 'EACCES');
      assert.ok(
        stub.calls.length < 30,
        `${stub.calls.length} paid calls were made after the first write failed`,
      );
      // Only the calls that were already running when the first write failed: one pool of width w per seat.
      const inFlight = SEATS.reduce(
        (sum, seat) => sum + Math.min(10, judgeConcurrency(config, seat)),
        0,
      );
      assert.ok(stub.calls.length <= inFlight, `${stub.calls.length} calls`);
    } finally {
      fs.chmodSync(folder, 0o700);
    }
  }));

test('a judgment that cannot be saved for any other reason also stops the seats (the folder is a file)', () =>
  withRepo(async ({ layout, config, run }) => {
    fs.mkdirSync(layout.runDir, { recursive: true });
    fs.writeFileSync(path.join(layout.runDir, 'judgments'), 'not a folder');
    const stub = stubJudge();
    await assert.rejects(
      run(stub),
      (error) => typeof error.code === 'string' && error.code !== 'EACCES',
    );
    const inFlight = SEATS.reduce(
      (sum, seat) => sum + Math.min(10, judgeConcurrency(config, seat)),
      0,
    );
    assert.ok(
      stub.calls.length <= inFlight,
      `${stub.calls.length} paid calls were made after the first write failed`,
    );
  }));

test('runJudging books each call from the cost profile the calls were priced with (callOptions.costProfile)', () =>
  withRepo(async ({ run }) => {
    const costProfile = {
      entries: [
        { kind: 'judge', model: '*', mean: 0.02, median: 0.02, p90: 0.03 },
      ],
    };
    const stub = stubJudge(async (args) => ({
      ...okResult(labelsReply(args.prompt)),
      reportedUsd: null,
    }));
    const summary = await run(stub, { callOptions: { costProfile } });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.ok(stub.calls.every((args) => args.costProfile === costProfile));
    assert.ok(
      Math.abs(summary.usd - 30 * 0.02) < 1e-9,
      `${summary.usd} != ${30 * 0.02}`,
    );
  }));

test('runJudging items: one call per task, seat and arm, a valid record each, and a rerun has nothing to do', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge();
    const lines = [];
    let credentialExports = 0;
    const summary = await run(stub, {
      log: (line) => lines.push(line),
      getCredentials: async () => {
        credentialExports += 1;
        return FRESH;
      },
    });
    assert.equal(credentialExports, 1, 'exported once for all 30 calls');
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(summary.jobs, 30);
    assert.equal(summary.pending, 0);
    assert.equal(summary.done, 30);
    assert.equal(summary.remaining, 0);
    assert.equal(stub.calls.length, 30);
    assert.equal(summary.results.judged.length, 30);
    assert.equal(judgmentFiles(layout, 'items').length, 30);
    assert.deepEqual(judgmentFiles(layout, 'outcome'), []);
    // The stub reports 0.005 USD a call. The openai seat's model reports low (cliReportsLow), so its 10 calls are
    // charged its mean instead.
    const expectedUsd = 20 * 0.005 + 10 * SEAT_PRICES.openai.mean;
    assert.ok(
      Math.abs(summary.usd - expectedUsd) < 1e-9,
      `${summary.usd} != ${expectedUsd}`,
    );
    assert.match(lines[0], /reading B \(scale items, prompt v1\)/);
    assert.match(lines[0], /0\/30 judgment\(s\) current, 30 to make/);

    const record = judgmentOf(layout, 'items', TASKS[0], 'openai', 'with');
    assert.equal(record.kind, 'judgment');
    assert.equal(record.status, 'valid');
    assert.equal(record.scale, 'items');
    assert.equal(record.reading, 'B');
    assert.equal(record.arm, 'with');
    assert.equal(record.judge_model, 'us.openai.gpt-6.1-terra');
    assert.equal(record.prompt_sha256, judgeFor('items').sha256);
    assert.equal(record.item_count, 5);
    assert.equal(record.inputs.opencode_version, '1.2.3-fixture');
    assert.equal(record.inputs.arm, 'with');
    assert.equal(record.inputs.answer_sha256, sha256(WITH_TEXT));
    assert.equal(record.score, 5);
    assert.deepEqual(record.guard, { items: 1, met: 1 });
    assert.deepEqual(record.labels, Array(5).fill('MET'));
    assert.equal(
      record.normalized,
      null,
      'an items judgment has no normalized score',
    );
    assert.equal(record.reason, 'item 2 decided the labels');
    const call = stub.calls.find((entry) =>
      entry.label.endsWith(`${TASKS[0]}:items:openai:with`),
    );
    assert.equal(record.raw_text, labelsReply(call.prompt));
    assert.equal(record.attempts, 1);
    assert.deepEqual(record.usage, { input_tokens: 1000, output_tokens: 100 });
    assert.equal(record.usage_source, 'stream');
    assert.equal(record.reported_usd, 0.005);
    assert.equal(record.ms, 3);
    assert.equal(record.answer.judge_input.eligible, true);
    assert.equal(record.answer.arm_blinding_version, 1);
    // The openai seat's model reports low, so the 0.005 USD the stub reports is charged at the model's mean.
    assert.equal(record.usd, roundUsd(SEAT_PRICES.openai.mean));
    assert.equal(record.usd, 0.0134);
    assert.ok(!('order' in record) && !('slot' in record));
    const other = judgmentOf(layout, 'items', TASKS[0], 'openai', 'without');
    assert.equal(other.arm, 'without');
    assert.equal(other.inputs.answer_sha256, sha256(WITHOUT_TEXT));
    assert.equal(other.score, 1.8);
    assert.deepEqual(other.guard, { items: 1, met: 0 });

    // Every task counts: three seats with both arms valid, all with the same gap.
    assert.equal(summary.tasks.length, 5);
    for (const task of summary.tasks) {
      assert.equal(task.counted, true, JSON.stringify(task));
      assert.equal(task.seats_valid, 3);
      assert.ok(Math.abs(task.gap - 3.2) < 1e-9);
    }

    const again = stubJudge();
    // A run with every judgment current reads no version.
    let versionReads = 0;
    const rerun = await run(again, {
      readVersion: async () => {
        versionReads += 1;
        return 'unused';
      },
    });
    assert.equal(rerun.status, 'done');
    assert.equal(rerun.done, 30);
    assert.equal(again.calls.length, 0);
    assert.equal(versionReads, 0);
  }));

test('blinding: a judge sees the request, the rules checklist and one answer, never its arm or the other answer', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge();
    await run(stub);
    const tasks = helpers.readJson(layout.tasksFile(SKILL, 'b1')).scenarios;
    for (const call of stub.calls) {
      const [, taskId, seatName, arm] =
        /\/(brew-log-rules-\d):items:([a-z]+):(with|without)$/.exec(call.label);
      const task = tasks.find((entry) => entry.id === taskId);
      const shown = readPrompt(call.prompt);
      assert.equal(shown.request, task.prompt);
      assert.deepEqual(shown.checklist, task.rubric);
      assert.equal(
        shown.answer,
        arm === 'with' ? WITH_TEXT : WITHOUT_TEXT,
        call.label,
      );
      // The other arm's answer, the arm name and any second answer block never reach the judge. The words are checked
      // in what the bench adds around the request, the checklist and the answer, which are the task's own text.
      assert.equal(
        call.prompt.includes(arm === 'with' ? WITHOUT_TEXT : WITH_TEXT),
        false,
      );
      const frame = shown.checklist.reduce(
        (text, item) => text.replace(item, ''),
        call.prompt.replace(shown.request, '').replace(shown.answer, ''),
      );
      for (const word of [
        'with the skill',
        'without',
        'ANSWER_A',
        'ANSWER_B',
        'skill',
        'arm',
      ])
        assert.equal(
          frame.toLowerCase().includes(word.toLowerCase()),
          false,
          word,
        );
      assert.equal(call.prompt.match(/<<<ANSWER /g).length, 1);
      // Nothing else of the task reaches the judge: not its id, title or target section.
      assert.equal(call.prompt.includes(task.id), false);
      assert.equal(call.prompt.includes(task.title), false);
      assert.equal(call.prompt.includes(SKILL), false);
      const record = judgmentOf(layout, 'items', taskId, seatName, arm);
      assert.equal(record.arm, arm);
      assert.equal(record.score, arm === 'with' ? 5 : 1.8);
    }
  }));

test('runJudging: each call uses its seat model and its seat timeout', () =>
  withRepo(async ({ run }) => {
    const stub = stubJudge();
    await run(stub);
    const config = helpers.exampleConfig();
    assert.equal(stub.calls.length, 30);
    for (const call of stub.calls) {
      const seat = call.label.split(':')[2];
      assert.equal(call.modelId, config.models.judges[seat]);
      assert.equal(call.timeoutMs, seat === 'xai' ? 720000 : 240000);
    }
  }));

test('runJudging: the seats run side by side, each in its own pool', () =>
  withRepo(
    async ({ run }) => {
      const live = new Map();
      const peak = new Map();
      let total = 0;
      let totalPeak = 0;
      const stub = stubJudge(async (args) => {
        const seat = args.label.split(':')[2];
        live.set(seat, (live.get(seat) || 0) + 1);
        total += 1;
        peak.set(seat, Math.max(peak.get(seat) || 0, live.get(seat)));
        totalPeak = Math.max(totalPeak, total);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live.set(seat, live.get(seat) - 1);
        total -= 1;
        return okResult(labelsReply(args.prompt));
      });
      const summary = await run(stub);
      assert.equal(summary.status, 'done');
      assert.equal(peak.get('anthropic'), 1);
      assert.equal(peak.get('openai'), 1);
      assert.equal(peak.get('xai'), 2);
      assert.ok(totalPeak >= 3, `seats overlap: peak ${totalPeak}`);
    },
    { config: { judge_concurrency: 1, judge_concurrency_by_seat: { xai: 2 } } },
  ));

test('runJudging outcome: waits for the request-only checklists, then judges against them, never against the rubric', () =>
  withRepo(async ({ layout, config, run }) => {
    const early = stubJudge();
    const waiting = await run(early, { scale: 'outcome' });
    assert.equal(early.calls.length, 0);
    assert.equal(waiting.status, 'partial');
    assert.equal(waiting.jobs, 24, 'the excluded task has no reading A jobs');
    assert.equal(waiting.waiting.length, 24);
    assert.match(
      waiting.waiting[0].reason,
      /the request-only checklist is missing/,
    );
    assert.deepEqual(
      waiting.excluded.map((record) => [record.skill, record.batch, record.id]),
      [[SKILL, 'b1', EXCLUDED]],
    );

    await writeChecklists(layout, config);
    const stub = stubJudge();
    const summary = await run(stub, { scale: 'outcome' });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(stub.calls.length, 24);
    assert.equal(judgmentFiles(layout, 'outcome').length, 24);
    const tasks = helpers.readJson(layout.tasksFile(SKILL, 'b1')).scenarios;
    for (const call of stub.calls) {
      const taskId = /\/(brew-log-rules-\d):/.exec(call.label)[1];
      assert.notEqual(taskId, EXCLUDED);
      const checklist = helpers.readJson(
        layout.checklistFile(SKILL, 'b1', taskId),
      ).items;
      const shown = readPrompt(call.prompt);
      assert.deepEqual(shown.checklist, checklist);
      const rubric = tasks.find((task) => task.id === taskId).rubric;
      assert.equal(
        rubric.some((item) => call.prompt.includes(item)),
        false,
      );
    }
    const record = judgmentOf(layout, 'outcome', TASKS[0], 'anthropic');
    assert.equal(record.reading, 'A');
    assert.equal(record.scale, 'outcome');
    assert.equal(record.guard, null);
    assert.equal(record.checklist.writer_model, 'us.anthropic.claude-opus-5-5');
    assert.equal(
      record.inputs.checklist_sha256,
      sha256({
        items: helpers.readJson(layout.checklistFile(SKILL, 'b1', TASKS[0]))
          .items,
      }),
    );
  }));

test('a new request-only checklist makes its outcome judgments pending, and their old files are kept', () =>
  withRepo(async ({ layout, config, run }) => {
    await writeChecklists(layout, config);
    await run(stubJudge(), { scale: 'outcome' });
    helpers.update(layout.checklistFile(SKILL, 'b1', TASKS[0]), (record) => {
      record.items[0] = 'The entry gives the one detail that changed here.';
      // A checklist written again carries the digest of its new items.
      record.items_sha256 = sha256({ items: record.items });
    });
    const stub = stubJudge();
    const summary = await run(stub, { scale: 'outcome' });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.deepEqual(
      stub.calls.map((call) => call.label).sort(),
      SEATS.flatMap((seat) =>
        ['with', 'without'].map(
          (arm) => `${SKILL}/b1/${TASKS[0]}:outcome:${seat}:${arm}`,
        ),
      ),
    );
    assert.equal(
      readPrompt(stub.calls[0].prompt).checklist[0],
      'The entry gives the one detail that changed here.',
    );
    assert.equal(keptFiles(layout, 'outcome', '.superseded-').length, 6);
  }));

test('a request-only checklist written for another request waits; it is never judged against', () =>
  withRepo(async ({ layout, config, run }) => {
    await writeChecklists(layout, config);
    helpers.update(layout.checklistFile(SKILL, 'b1', TASKS[0]), (record) => {
      record.request_sha256 = '7'.repeat(64);
    });
    const stub = stubJudge();
    const summary = await run(stub, { scale: 'outcome' });
    assert.equal(summary.status, 'partial');
    assert.equal(stub.calls.length, 18);
    assert.equal(summary.waiting.length, 6);
    assert.match(summary.waiting[0].reason, /checklist is stale/);
  }));

test('an outcome run leaves every items judgment byte-identical, and one scale never counts as done for the other', () =>
  withRepo(async ({ layout, config, run }) => {
    await run(stubJudge());
    const itemsDir = path.join(layout.runDir, 'judgments', 'items');
    const before = judgmentFiles(layout, 'items').map((name) =>
      fs.readFileSync(path.join(itemsDir, name)),
    );
    await writeChecklists(layout, config);
    const outcome = stubJudge();
    await run(outcome, { scale: 'outcome' });
    assert.equal(outcome.calls.length, 24);
    assert.deepEqual(
      judgmentFiles(layout, 'items').map((name) =>
        fs.readFileSync(path.join(itemsDir, name)),
      ),
      before,
    );
    // An items record copied to the outcome path is not an outcome judgment: it is pending there.
    const outcomeFile = layout.judgmentFile(
      'outcome',
      SKILL,
      'b1',
      TASKS[1],
      'xai',
      'with',
    );
    fs.copyFileSync(
      layout.judgmentFile('items', SKILL, 'b1', TASKS[1], 'xai', 'with'),
      outcomeFile,
    );
    const again = stubJudge();
    const summary = await run(again, { scale: 'outcome' });
    assert.equal(again.calls.length, 1);
    assert.equal(
      summary.results.judged[0],
      `${SKILL}/b1/${TASKS[1]}:outcome:xai:with`,
    );
    assert.equal(keptFiles(layout, 'outcome', '.superseded-').length, 1);
    const current = helpers.readJson(outcomeFile);
    assert.equal(current.scale, 'outcome');
    assert.equal(
      judgeJob.judgmentCurrent(current, {
        scale: 'items',
        seat: current.seat,
        arm: current.arm,
        buckets: null,
        inputs: current.inputs,
      }),
      false,
    );
  }));

// ---- currency and resume -----------------------------------------------------------------------------------------

test('resume: a judgment made with another prompt, model, sanitizer or answer is pending and made again; current ones are kept', () =>
  withRepo(async ({ layout, run }) => {
    await run(stubJudge());
    const edits = [
      [
        TASKS[0],
        'anthropic',
        (record) => (record.inputs.judge_prompt_sha256 = 'f'.repeat(64)),
      ],
      [
        TASKS[1],
        'openai',
        (record) => (record.inputs.judge_model = 'other-model'),
      ],
      [
        TASKS[2],
        'xai',
        (record) => (record.inputs.sanitizer_rules_sha256 = 'e'.repeat(64)),
      ],
      [
        TASKS[3],
        'anthropic',
        (record) => (record.inputs.answer_sha256 = 'd'.repeat(64)),
      ],
    ];
    for (const [taskId, seat, change] of edits)
      helpers.update(
        layout.judgmentFile('items', SKILL, 'b1', taskId, seat, 'with'),
        (record) => {
          change(record);
          // The digest is replaced with a value that does not match today's inputs, so the record is not current.
          record.inputs.input_sha256 = sha256(`edited ${taskId} ${seat}`);
        },
      );
    // A record with no digest at all, a status that is not done, and a file that is not JSON are pending too.
    helpers.update(
      layout.judgmentFile('items', SKILL, 'b1', TASKS[4], 'openai', 'with'),
      (record) => {
        record.status = 'failed';
      },
    );
    helpers.write(
      layout.judgmentFile('items', SKILL, 'b1', TASKS[4], 'xai', 'without'),
      '{ not json',
    );
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(summary.status, 'done');
    assert.deepEqual(
      stub.calls.map((call) => call.label).sort(),
      [
        `${SKILL}/b1/${TASKS[0]}:items:anthropic:with`,
        `${SKILL}/b1/${TASKS[1]}:items:openai:with`,
        `${SKILL}/b1/${TASKS[2]}:items:xai:with`,
        `${SKILL}/b1/${TASKS[3]}:items:anthropic:with`,
        `${SKILL}/b1/${TASKS[4]}:items:openai:with`,
        `${SKILL}/b1/${TASKS[4]}:items:xai:without`,
      ].sort(),
    );
    assert.equal(keptFiles(layout, 'items', '.superseded-').length, 6);
  }));

test('resume: a new answer for one arm makes only that arm judgments pending; the other arm stays current', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    const taskSet = writeAnswers(layout, config, tmpRoot);
    await run(stubJudge());
    const otherBefore = SEATS.map((seat) =>
      fs.readFileSync(
        layout.judgmentFile('items', SKILL, 'b1', TASKS[0], seat, 'without'),
      ),
    );
    const task = taskSet.batches[0].tasks.find(
      (entry) => entry.id === TASKS[0],
    );
    writeAnswer(layout, {
      batch: 'b1',
      task,
      arm: 'with',
      text: `${WITH_TEXT} A second pot was sweeter.`,
    });
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.deepEqual(
      stub.calls.map((call) => call.label).sort(),
      SEATS.map((seat) => `${SKILL}/b1/${TASKS[0]}:items:${seat}:with`),
    );
    assert.deepEqual(
      SEATS.map((seat) =>
        fs.readFileSync(
          layout.judgmentFile('items', SKILL, 'b1', TASKS[0], seat, 'without'),
        ),
      ),
      otherBefore,
      'the without judgments are byte-identical',
    );
  }));

test('resume: an edited judge prompt template makes every judgment pending and no answer stale', () =>
  withRepo(async ({ layout, run }) => {
    await run(stubJudge());
    const answersBefore = fs.readdirSync(
      path.join(layout.runDir, 'answers', SKILL, 'b1'),
    );
    for (const name of judgmentFiles(layout, 'items'))
      helpers.update(
        path.join(layout.runDir, 'judgments', 'items', name),
        (record) => {
          record.inputs.judge_prompt_sha256 = '0'.repeat(64);
          record.inputs.input_sha256 = '1'.repeat(64);
        },
      );
    const plan = judgeJob.planJudging({
      layout,
      config: helpers.exampleConfig(),
      skills: [SKILL],
      scale: 'items',
      judgeInput:
        require('../../../scripts/bench/lib/judge-input').createJudgeInput(),
      armsTmpRoot: path.join(path.dirname(layout.root), 'tmp'),
    });
    assert.deepEqual(
      [...new Set(plan.jobs.map((entry) => entry.state))],
      ['pending'],
    );
    assert.deepEqual(
      fs.readdirSync(path.join(layout.runDir, 'answers', SKILL, 'b1')),
      answersBefore,
    );
  }));

test('judgmentCurrent: only a finished record of the job scale with the same input digest', () => {
  const inputs = { input_sha256: 'a'.repeat(64) };
  const job = {
    scale: 'items',
    seat: 'xai',
    arm: 'with',
    buckets: ['value', 'guard'],
    inputs,
  };
  const record = {
    kind: 'judgment',
    scale: 'items',
    status: 'valid',
    seat: 'xai',
    arm: 'with',
    score: 3.5,
    guard: { items: 1, met: 0.5 },
    inputs,
  };
  assert.equal(judgeJob.judgmentCurrent(record, job), true);
  // An ineligible record has no score or guard to check.
  assert.equal(
    judgeJob.judgmentCurrent(
      { kind: 'judgment', scale: 'items', status: 'ineligible', inputs },
      job,
    ),
    true,
  );
  for (const other of [
    { ...record, status: 'failed' },
    { ...record, status: undefined },
    { ...record, kind: 'answer' },
    { ...record, scale: 'outcome' },
    { ...record, inputs: { input_sha256: 'b'.repeat(64) } },
    { ...record, inputs: null },
    null,
    [],
  ])
    assert.equal(
      judgeJob.judgmentCurrent(other, job),
      false,
      JSON.stringify(other),
    );
  assert.equal(
    judgeJob.judgmentCurrent(record, { ...job, inputs: null }),
    false,
  );
});

test('judgmentCurrent: a valid record needs the seat, arm, score and guard of its judgment', () => {
  const inputs = { input_sha256: 'a'.repeat(64) };
  const items = {
    scale: 'items',
    seat: 'xai',
    arm: 'with',
    buckets: ['value', 'guard', 'guard'],
    inputs,
  };
  const valid = {
    kind: 'judgment',
    scale: 'items',
    status: 'valid',
    seat: 'xai',
    arm: 'with',
    score: 3.5,
    guard: { items: 2, met: 1.5 },
    inputs,
  };
  assert.equal(judgeJob.judgmentCurrent(valid, items), true);
  for (const score of [1, 5]) {
    assert.equal(judgeJob.judgmentCurrent({ ...valid, score }, items), true);
  }
  assert.equal(
    judgeJob.judgmentCurrent({ ...valid, guard: { items: 2, met: 0 } }, items),
    true,
  );
  assert.equal(
    judgeJob.judgmentCurrent({ ...valid, guard: { items: 2, met: 2 } }, items),
    true,
  );
  const bad = {
    'another seat': { seat: 'openai' },
    'a seat that is not a name': { seat: 'Bad Seat!' },
    'no seat': { seat: undefined },
    'the other arm': { arm: 'without' },
    'no arm': { arm: undefined },
    'a score as text': { score: '3.5' },
    'no score': { score: undefined },
    'a score of null': { score: null },
    'a score that is not finite': { score: Infinity },
    'a score below 1': { score: 0.9 },
    'a score above 5': { score: 5.1 },
    'no guard where the checklist has guard items': { guard: null },
    'a guard that is missing': { guard: undefined },
    'a guard with the wrong item count': { guard: { items: 1, met: 1 } },
    'a guard met above its items': { guard: { items: 2, met: 2.5 } },
    'a guard met below 0': { guard: { items: 2, met: -0.5 } },
    'a guard met as text': { guard: { items: 2, met: '1' } },
    'a guard that is not an object': { guard: 2 },
  };
  for (const [what, change] of Object.entries(bad))
    assert.equal(
      judgeJob.judgmentCurrent({ ...valid, ...change }, items),
      false,
      what,
    );
  // A checklist with no guard item, and reading A (no buckets), give a guard of null and nothing else.
  for (const job of [
    { ...items, buckets: ['value', 'format'] },
    { ...items, scale: 'outcome', buckets: null },
  ]) {
    const record = { ...valid, scale: job.scale, guard: null };
    assert.equal(judgeJob.judgmentCurrent(record, job), true);
    assert.equal(
      judgeJob.judgmentCurrent({ ...record, guard: { items: 1, met: 1 } }, job),
      false,
    );
    assert.equal(
      judgeJob.judgmentCurrent({ ...record, guard: undefined }, job),
      false,
    );
  }
});

test('a stored valid judgment with a field out of place is set aside and made again; it never stops the reading, even a dry run', () =>
  withRepo(async ({ layout, run }) => {
    await run(stubJudge());
    // One judgment each: a truncated or hand-edited record, or one copied between seat folders.
    const edits = [
      [TASKS[0], 'anthropic', 'with', (record) => (record.score = 'x')],
      [TASKS[1], 'openai', 'with', (record) => (record.guard = null)],
      [TASKS[2], 'xai', 'with', (record) => (record.seat = 'Bad Seat!')],
      [TASKS[3], 'anthropic', 'without', (record) => (record.seat = 'openai')],
      [TASKS[4], 'openai', 'without', (record) => (record.arm = 'with')],
      [TASKS[0], 'xai', 'without', (record) => (record.score = 6)],
      [
        TASKS[1],
        'xai',
        'with',
        (record) => (record.guard = { items: 1, met: 2 }),
      ],
    ];
    for (const [taskId, seat, arm, change] of edits)
      helpers.update(
        layout.judgmentFile('items', SKILL, 'b1', taskId, seat, arm),
        change,
      );
    const dry = stubJudge();
    const planned = await run(dry, { dryRun: true });
    assert.equal(planned.status, 'dry-run');
    assert.equal(planned.pending, edits.length);
    assert.equal(dry.calls.length, 0);
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.deepEqual(
      stub.calls.map((call) => call.label).sort(),
      edits
        .map(
          ([taskId, seat, arm]) => `${SKILL}/b1/${taskId}:items:${seat}:${arm}`,
        )
        .sort(),
    );
    assert.equal(
      keptFiles(layout, 'items', '.superseded-').length,
      edits.length,
    );
    for (const task of summary.tasks) assert.equal(task.counted, true);
  }));

// ---- answers that wait, are not loaded or are not eligible -------------------------------------------------------

test('a task with a missing answer waits; every other task is still judged', () =>
  withRepo(
    async ({ layout, config, tmpRoot, run }) => {
      writeAnswers(layout, config, tmpRoot, (arm, taskId) =>
        taskId === TASKS[1] && arm === 'without'
          ? null
          : arm === 'with'
            ? WITH_TEXT
            : WITHOUT_TEXT,
      );
      const stub = stubJudge();
      const summary = await run(stub);
      assert.equal(summary.status, 'partial');
      assert.equal(stub.calls.length, 27, 'the with answer is still judged');
      assert.equal(summary.waiting.length, 3);
      assert.match(
        summary.waiting[0].reason,
        /waits for the pairs job: the without answer is missing/,
      );
      assert.equal(summary.remaining, 3);
      const row = summary.tasks.find((task) => task.task_id === TASKS[1]);
      assert.equal(
        row.counted,
        false,
        'a seat with one valid arm does not count',
      );
    },
    { answers: false },
  ));

test('arm blinding: an answer made under older inputs is stale, so its judgments wait and old ones do not count', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    await run(stubJudge());
    const { taskSet } = loadTaskSet({ layout, config, skill: SKILL, tmpRoot });
    const task = taskSet.batches[0].tasks[0];
    // The same text under another arm blinding version: the answer digest differs from today's.
    writeAnswer(layout, {
      batch: 'b1',
      task,
      arm: 'with',
      text: WITH_TEXT,
      inputs: {
        ...task.inputs.with,
        arm_blinding_version: 0,
        input_sha256: sha256('older arm prompts'),
      },
    });
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(stub.calls.length, 0);
    assert.equal(summary.status, 'partial');
    assert.equal(summary.waiting.length, 3);
    assert.match(summary.waiting[0].reason, /the with answer is stale/);
    const row = summary.tasks.find((entry) => entry.task_id === task.id);
    assert.equal(
      row.counted,
      false,
      'a judgment of a stale answer is never counted',
    );
  }));

test('an answer stored as not loaded is never judged, nor is the other arm of its task, and its task does not count', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    const { taskSet } = loadTaskSet({ layout, config, skill: SKILL, tmpRoot });
    const task = taskSet.batches[0].tasks[2];
    writeAnswer(layout, {
      batch: 'b1',
      task,
      arm: 'with',
      text: null,
      status: 'not_loaded',
    });
    const stub = stubJudge();
    const lines = [];
    const summary = await run(stub, { log: (line) => lines.push(line) });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(stub.calls.length, 24, 'neither arm of the task is judged');
    assert.equal(
      stub.calls.some((call) =>
        call.label.startsWith(`${SKILL}/b1/${TASKS[2]}:`),
      ),
      false,
    );
    assert.equal(summary.not_loaded, 3);
    assert.equal(summary.other_arm_unusable, 3);
    assert.equal(summary.pending, 0);
    assert.equal(summary.remaining, 0);
    // 24 judgments, 8 per seat, each at its seat model's upper estimate (p90).
    assert.equal(summary.projected_usd, roundUsd(8 * P90_PER_SEAT_ROUND));
    assert.equal(summary.projected_usd, 1.5246);
    assert.match(lines[0], /3 not judged because the other arm's answer/);
    assert.equal(judgmentFiles(layout, 'items').length, 24);
    const row = summary.tasks.find((entry) => entry.task_id === TASKS[2]);
    assert.equal(row.counted, false);
    assert.match(row.invalid, /the with answer is stored as not loaded/);
    const { jobs } = judgeJob.planJudging({
      layout,
      config,
      skills: [SKILL],
      scale: 'items',
      judgeInput:
        require('../../../scripts/bench/lib/judge-input').createJudgeInput(),
      armsTmpRoot: tmpRoot,
    });
    const held = jobs.filter((entry) => entry.state === 'other_arm_unusable');
    assert.deepEqual(
      held.map((entry) => entry.label),
      SEATS.map((seat) => `${SKILL}/b1/${TASKS[2]}:items:${seat}:without`),
    );
    assert.match(
      held[0].reason,
      /not judged: the with answer is stored as not loaded/,
    );
    // plan agrees with the job: neither the held judgments nor the not loaded arm's are a call.
    const judgeB = buildPlan({ layout, config, skills: [SKILL] }).stages.find(
      (stage) => stage.id === 2,
    ).calls.judgeB;
    assert.deepEqual(judgeB, { done: 24, total: 24 });

    // Once the with answer can be used, the held judgments are pending again and both arms are judged.
    writeAnswer(layout, { batch: 'b1', task, arm: 'with', text: WITH_TEXT });
    const again = stubJudge();
    const rerun = await run(again);
    assert.equal(rerun.status, 'done', JSON.stringify(rerun));
    assert.equal(again.calls.length, 6);
    assert.equal(rerun.other_arm_unusable, 0);
    assert.equal(
      rerun.tasks.find((entry) => entry.task_id === TASKS[2]).counted,
      true,
    );
  }));

test('plan counts a judgment of a not loaded answer only when its file is there', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    await run(stubJudge());
    const { taskSet } = loadTaskSet({ layout, config, skill: SKILL, tmpRoot });
    const task = taskSet.batches[0].tasks[2];
    writeAnswer(layout, {
      batch: 'b1',
      task,
      arm: 'with',
      text: null,
      status: 'not_loaded',
    });
    const judgeB = () =>
      buildPlan({ layout, config, skills: [SKILL] }).stages.find(
        (stage) => stage.id === 2,
      ).calls.judgeB;
    assert.deepEqual(judgeB(), { done: 30, total: 30 });
    for (const seat of SEATS)
      fs.unlinkSync(
        layout.judgmentFile('items', SKILL, 'b1', task.id, seat, 'with'),
      );
    // The three missing `with` judgments are no call (the answer is never judged); the `without` ones are made.
    assert.deepEqual(judgeB(), { done: 27, total: 27 });
  }));

test('an answer that is not eligible is never sent to a judge: an ineligible record, no call, no cost', () =>
  withRepo(
    async ({ layout, config, tmpRoot, run }) => {
      writeAnswers(layout, config, tmpRoot, (arm, taskId) =>
        taskId === TASKS[0] && arm === 'without'
          ? 'I loaded the brew-log skill. Tea.'
          : arm === 'with'
            ? WITH_TEXT
            : WITHOUT_TEXT,
      );
      const stub = stubJudge();
      const summary = await run(stub);
      assert.equal(summary.status, 'done', JSON.stringify(summary));
      assert.equal(stub.calls.length, 24);
      assert.equal(
        stub.calls.some((call) =>
          call.label.startsWith(`${SKILL}/b1/${TASKS[0]}:`),
        ),
        false,
        'neither arm of the task is sent to a judge',
      );
      assert.equal(summary.results.ineligible.length, 3);
      assert.equal(summary.other_arm_unusable, 3);
      const record = judgmentOf(layout, 'items', TASKS[0], 'xai', 'without');
      assert.equal(record.status, 'ineligible');
      assert.equal(record.arm, 'without');
      assert.equal(record.usd, 0);
      assert.match(
        record.reason,
        /the without answer is not eligible: sanitizer removed/,
      );
      assert.equal(record.answer.judge_input.eligible, false);
      assert.equal(record.labels, undefined);
      // The eligible arm is not judged and gets no file: its seat could never count.
      assert.equal(
        fs.existsSync(
          layout.judgmentFile('items', SKILL, 'b1', TASKS[0], 'xai', 'with'),
        ),
        false,
      );
      const row = summary.tasks.find((entry) => entry.task_id === TASKS[0]);
      assert.equal(row.counted, false);
      // The ineligible record is current: a rerun neither calls nor writes again, and the other arm stays held.
      const again = stubJudge();
      const rerun = await run(again);
      assert.equal(again.calls.length, 0);
      assert.equal(rerun.results.ineligible.length, 0);
      assert.equal(rerun.other_arm_unusable, 3);
      assert.equal(rerun.pending, 0);
      assert.equal(keptFiles(layout, 'items', '.superseded-').length, 0);
      const judgeB = buildPlan({ layout, config, skills: [SKILL] }).stages.find(
        (stage) => stage.id === 2,
      ).calls.judgeB;
      assert.deepEqual(judgeB, { done: 27, total: 27 });
    },
    { answers: false },
  ));

test('a judge prompt above the one-argument byte limit is recorded ineligible with no call; the other arm of its task is not judged, and the other judgments are made', () =>
  withRepo(
    async ({ layout, config, tmpRoot, run }) => {
      // Under the 50000-character answer cap, but 3 bytes per character: the prompt passes MAX_PROMPT_BYTES.
      const longText = `Brew log: ${'茶'.repeat(45000)}`;
      writeAnswers(layout, config, tmpRoot, (arm, taskId) =>
        taskId === TASKS[0] && arm === 'with'
          ? longText
          : arm === 'with'
            ? WITH_TEXT
            : WITHOUT_TEXT,
      );
      // judgeCall refuses a prompt above the limit, as opencode.js does.
      const stub = stubJudge((args) => {
        if (Buffer.byteLength(args.prompt, 'utf8') > MAX_PROMPT_BYTES)
          throw new RangeError('refusing to run: the judge prompt is too long');
        return okResult(labelsReply(args.prompt));
      });
      const summary = await run(stub);
      assert.equal(summary.status, 'done', JSON.stringify(summary));
      assert.equal(stub.calls.length, 24);
      assert.equal(summary.results.judged.length, 24);
      assert.equal(summary.results.ineligible.length, 3);
      assert.equal(summary.other_arm_unusable, 3);
      const record = judgmentOf(layout, 'items', TASKS[0], 'anthropic', 'with');
      assert.equal(record.status, 'ineligible');
      assert.equal(record.usd, 0);
      assert.match(
        record.reason,
        new RegExp(
          `^the judge prompt is \\d+ bytes, above the ${MAX_PROMPT_BYTES}-byte limit`,
        ),
      );
      assert.equal(record.answer.judge_input.eligible, true);
      const row = summary.tasks.find((entry) => entry.task_id === TASKS[0]);
      assert.equal(row.counted, false);
      assert.match(row.invalid, /the judge prompt is \d+ bytes/);
      // The ineligible record is current: a rerun neither calls nor writes again.
      const again = stubJudge();
      const rerun = await run(again);
      assert.equal(rerun.status, 'done', JSON.stringify(rerun));
      assert.equal(again.calls.length, 0);
    },
    { answers: false },
  ));

test('a judge prompt of exactly the byte limit is sent; one byte more is recorded ineligible with no call', () =>
  withRepo(
    async ({ layout, config, tmpRoot, run }) => {
      const base = `Brew log: ${'茶'.repeat(40000)}`;
      const write = (text) =>
        writeAnswers(layout, config, tmpRoot, (arm, taskId) =>
          taskId === TASKS[0] && arm === 'with'
            ? text
            : arm === 'with'
              ? WITH_TEXT
              : WITHOUT_TEXT,
        );
      const callOf = (stub) =>
        stub.calls.find((entry) =>
          entry.label.endsWith(`${TASKS[0]}:items:anthropic:with`),
        );
      write(base);
      const probe = stubJudge();
      await run(probe);
      const padding =
        MAX_PROMPT_BYTES - Buffer.byteLength(callOf(probe).prompt, 'utf8');
      assert.ok(padding > 0, 'the probe prompt is under the limit');

      write(`${base}${'a'.repeat(padding)}`);
      const exact = stubJudge();
      const exactRun = await run(exact);
      assert.equal(exactRun.status, 'done', JSON.stringify(exactRun));
      assert.equal(
        Buffer.byteLength(callOf(exact).prompt, 'utf8'),
        MAX_PROMPT_BYTES,
      );
      assert.equal(
        judgmentOf(layout, 'items', TASKS[0], 'anthropic', 'with').status,
        'valid',
      );

      write(`${base}${'a'.repeat(padding + 1)}`);
      const over = stubJudge();
      await run(over);
      assert.equal(
        callOf(over),
        undefined,
        'no call for a prompt over the limit',
      );
      assert.equal(
        judgmentOf(layout, 'items', TASKS[0], 'anthropic', 'with').status,
        'ineligible',
      );
    },
    { answers: false },
  ));

test('a reply in one code fence is accepted and the record says it was normalized', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge(async (args) =>
      okResult(`\`\`\`json\n${labelsReply(args.prompt)}\n\`\`\``),
    );
    const summary = await run(stub);
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(
      judgmentOf(layout, 'items', TASKS[0], 'anthropic', 'with').normalized,
      'fence',
    );
  }));

// ---- what a judgment record keeps of text ----------------------------------------------------------------------------

const SECRET = 'AKIA' + 'EXAMPLEFIXTURE12';

test('the reply text a valid judgment keeps (its reason and the whole reply) is redacted', () =>
  withRepo(async ({ layout, run }) => {
    const lines = [];
    const stub = stubJudge(async (args) => {
      const reply = JSON.parse(labelsReply(args.prompt));
      reply.reason = `the answer showed the key ${SECRET}`;
      return okResult(JSON.stringify(reply));
    });
    const summary = await run(stub, { log: (line) => lines.push(line) });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    const record = judgmentOf(layout, 'items', TASKS[0], 'xai');
    assert.equal(record.status, 'valid');
    assert.match(record.reason, /the answer showed the key/);
    assert.equal(record.reason.includes(SECRET), false, record.reason);
    assert.equal(record.raw_text.includes(SECRET), false, record.raw_text);
    assert.match(record.raw_text, /REDACTED/);
    const dir = path.join(layout.runDir, 'judgments');
    for (const name of fs.readdirSync(dir, { recursive: true }).map(String)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isFile())
        assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false);
    }
    assert.equal(lines.join('\n').includes(SECRET), false);
  }));

test('an ineligible record redacts its reason', () =>
  withRepo(async ({ layout, config, tmpRoot }) => {
    const { jobs } = judgeJob.planJudging({
      layout,
      config,
      skills: [SKILL],
      scale: 'items',
      judgeInput: createJudgeInput(),
      armsTmpRoot: tmpRoot,
    });
    const target = jobs[0];
    target.reason = `the with answer is not eligible: it showed ${SECRET}`;
    const record = judgeJob.ineligibleRecord(target, { now: () => NOW_MS });
    assert.equal(record.status, 'ineligible');
    assert.match(record.reason, /the with answer is not eligible: it showed/);
    assert.equal(record.reason.includes(SECRET), false, record.reason);
  }));

test('the judge-input step gets the task request, so text the user wrote stays in the answer', () =>
  withRepo(async ({ layout, config, tmpRoot }) => {
    writeAnswers(layout, config, tmpRoot, (arm) =>
      arm === 'with' ? WITH_TEXT : WITHOUT_TEXT,
    );
    const real = createJudgeInput();
    const requests = [];
    const spy = {
      ...real,
      prepare: (text, options) => {
        requests.push(options.request);
        return real.prepare(text, options);
      },
    };
    judgeJob.planJudging({
      layout,
      config,
      skills: [SKILL],
      scale: 'items',
      judgeInput: spy,
      armsTmpRoot: tmpRoot,
    });
    assert.ok(requests.length > 0);
    assert.ok(
      requests.every((request) => typeof request === 'string' && request),
    );
  }));

test('a record keeps what the judge-input step removed from an answer, never the answer text or a leak sample', () =>
  withRepo(
    async ({ layout, config, tmpRoot, run }) => {
      // "condition II" is an arm label that the sanitizer leaves in place, so scanLeaks reports it.
      const leaking = `${WITH_TEXT} Under condition II the tea was steeped.`;
      writeAnswers(layout, config, tmpRoot, (arm, taskId) =>
        taskId === TASKS[0] && arm === 'with'
          ? leaking
          : arm === 'with'
            ? WITH_TEXT
            : WITHOUT_TEXT,
      );
      const stub = stubJudge();
      const summary = await run(stub);
      assert.equal(summary.status, 'done', JSON.stringify(summary));
      const file = layout.judgmentFile(
        'items',
        SKILL,
        'b1',
        TASKS[0],
        'xai',
        'with',
      );
      const record = helpers.readJson(file);
      assert.equal(record.status, 'ineligible');
      assert.match(
        record.reason,
        /narration remains after sanitizing: arm-label/,
      );
      assert.deepEqual(record.answer.judge_input.leaks, [
        { id: 'arm-label', count: 1 },
      ]);
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(text.includes('condition II'), false);
      assert.equal(text.includes('sample'), false);
    },
    { answers: false },
  ));

// ---- failures, refusals and stops -----------------------------------------------------------------------------------

test('a failed call or an invalid reply writes no judgment, never a score of 0, and stays pending for plan and the job', () =>
  withRepo(async ({ layout, config, run }) => {
    const stub = stubJudge((args, index) =>
      args.label.endsWith(`${TASKS[0]}:items:anthropic:with`)
        ? failedResult('exit 1: boom')
        : args.label.endsWith(`${TASKS[1]}:items:openai:without`)
          ? okResult('{"items":["MET"],"reason":"one label only"}')
          : okResult(labelsReply(args.prompt)),
    );
    const summary = await run(stub);
    assert.equal(summary.status, 'partial');
    assert.deepEqual(
      summary.results.failed.map((entry) => entry.judgment).sort(),
      [
        `${SKILL}/b1/${TASKS[0]}:items:anthropic:with`,
        `${SKILL}/b1/${TASKS[1]}:items:openai:without`,
      ],
    );
    assert.match(
      summary.results.failed[0].reason + summary.results.failed[1].reason,
      /invalid reply \(labels\)/,
    );
    assert.equal(judgmentFiles(layout, 'items').length, 28);
    for (const [taskId, seat, arm] of [
      [TASKS[0], 'anthropic', 'with'],
      [TASKS[1], 'openai', 'without'],
    ])
      assert.equal(
        fs.existsSync(
          layout.judgmentFile('items', SKILL, 'b1', taskId, seat, arm),
        ),
        false,
      );
    assert.equal(summary.remaining, 2);
    assert.equal(summary.pending, 2);
    // The tasks still count with their two other seats; a seat with one valid arm is left out, never scored 0.
    for (const taskId of [TASKS[0], TASKS[1]]) {
      const row = summary.tasks.find((entry) => entry.task_id === taskId);
      assert.equal(row.counted, true);
      assert.equal(row.seats_valid, 2);
      assert.ok(Math.abs(row.gap - 3.2) < 1e-9);
    }
    const plan = buildPlan({ layout, config, skills: [SKILL] });
    const judgeB = plan.stages.find((stage) => stage.id === 2).calls.judgeB;
    assert.deepEqual(judgeB, { done: 28, total: 30 });
  }));

test('a reply cut off at the output limit is counted apart, whether the call failed or the reply could not be read, and the seat is passed on', () =>
  withRepo(async ({ run }) => {
    const labelOf = (index) => `${TASKS[index]}:items:anthropic:with`;
    const stub = stubJudge((args) => {
      if (args.label.endsWith(labelOf(0)))
        return {
          ...failedResult('reply cut off at the output limit of 9000 tokens'),
          cutOff: true,
        };
      if (args.label.endsWith(labelOf(1)))
        return {
          ...okResult('{"items":["MET","MI'),
          cutOff: true,
        };
      if (args.label.endsWith(labelOf(2)))
        return okResult('{"items":["MET"],"reason":"one label only"}');
      if (args.label.endsWith(labelOf(3))) return failedResult('exit 1: boom');
      // A reply that used the whole limit but reads fine is a judgment, and is not counted as cut off.
      return { ...okResult(labelsReply(args.prompt)), cutOff: true };
    });
    const summary = await run(stub);
    assert.equal(summary.results.failed.length, 4);
    // Each of the two judgments with an unusable cut-off reply is tried 3 times and cut off each time; the reply that
    // used the whole limit and read fine, and the plain failures, are not counted.
    assert.equal(summary.cut_off, 6);
    assert.ok(stub.calls.length > 4);
    for (const call of stub.calls)
      assert.equal(call.seat, call.label.split(':')[2], call.label);
  }));

test('the summary counts no cut-off reply when none was cut off', () =>
  withRepo(async ({ run }) => {
    const summary = await run(stubJudge());
    assert.equal(summary.cut_off, 0);
    assert.equal(summary.results.failed.length, 0);
  }));

test('a spend stop ends the job: no new call starts, finished judgments are kept, a rerun resumes', () =>
  withRepo(async ({ layout, run }) => {
    let made = 0;
    const stub = stubJudge(async (args) => {
      made += 1;
      if (made === 4)
        throw new SpendStopError('total_cap_usd reached', 'total_cap_usd');
      return okResult(labelsReply(args.prompt));
    });
    const summary = await run(stub, {});
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'spend');
    assert.match(summary.stop.message, /total_cap_usd reached/);
    const written = judgmentFiles(layout, 'items').length;
    assert.ok(written >= 3 && written < 30, String(written));
    assert.ok(stub.calls.length < 30);
    const again = stubJudge();
    const rerun = await run(again);
    assert.equal(rerun.status, 'done');
    assert.equal(again.calls.length, 30 - written);
  }));

test('a ledger that cannot be used stops the job; a bug in a call is thrown on', () =>
  withRepo(async ({ run }) => {
    const ledgerStop = await run(
      stubJudge(async () => {
        throw new LedgerError('the ledger lock could not be taken');
      }),
    );
    assert.equal(ledgerStop.status, 'stopped');
    assert.equal(ledgerStop.stop.kind, 'ledger');
    await assert.rejects(
      run(
        stubJudge(async () => {
          throw new TypeError('a bug');
        }),
      ),
      /a bug/,
    );
  }));

test('calls are booked in the ledger under the run, each with its judgment label', () =>
  withRepo(async ({ layout, config, run }) => {
    const stub = stubJudge(async (args) => {
      const reservation = await args.ledger.reserve(
        config.estimate_usd_per_call.judge,
        args.label,
      );
      reservation.settle({
        model: args.modelId,
        usage: { input_tokens: 1000, output_tokens: 100 },
        ok: true,
      });
      return okResult(labelsReply(args.prompt));
    });
    const summary = await run(stub);
    assert.equal(summary.status, 'done');
    const totals = readLedger(layout.ledgerFile);
    assert.equal(totals.calls, 30);
    assert.ok(totals.runs.get(layout.runId).spent > 0);
    const labels = fs
      .readFileSync(layout.ledgerFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((row) => row.type === 'settle')
      .map((row) => row.label)
      .sort();
    assert.deepEqual(labels, stub.calls.map((call) => call.label).sort());
  }));

test('a projection above max_usd with what the run already spent refuses the job before any call', () =>
  withRepo(async ({ layout, config, run }) => {
    // `plan` counts a judgment file as done even when it is stale; the job counts it pending. So with every items
    // judgment stale, plan passes and the job's own projection is what refuses.
    await run(stubJudge());
    for (const name of judgmentFiles(layout, 'items'))
      helpers.update(
        path.join(layout.runDir, 'judgments', 'items', name),
        (record) => {
          record.inputs.input_sha256 = '1'.repeat(64);
        },
      );
    const spentBefore = readLedger(layout.ledgerFile).runs.get(layout.runId);
    assert.equal(spentBefore, undefined, 'the stub books nothing');
    helpers.writeLedger(layout.ledgerFile, [
      {
        type: 'settle',
        id: 'x1',
        ts: '2026-11-10T11:00:00.000Z',
        run: layout.runId,
        label: 'earlier',
        usd: 28.3,
        status: 'ok',
        model: 'claude-sonnet-5-5',
        cost_source: 'reported',
      },
    ]);
    assert.equal(buildPlan({ layout, config, skills: [SKILL] }).ok, true);
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(summary.status, 'refused');
    assert.match(
      summary.refused.join('\n'),
      /the projected USD 1\.91 on top of USD 28\.30 already spent or reserved in run default is above max_usd 30/,
    );
    assert.equal(stub.calls.length, 0);
    assert.equal(keptFiles(layout, 'items', '.superseded-').length, 0);
  }));

test('the summary counts the judge calls charged at the estimate, per model, and logs them', () =>
  withRepo(async ({ config, run }) => {
    // Like the real call: reserve in the ledger it is given, then settle with no usable reported cost.
    const stub = stubJudge(async (args) => {
      const reservation = await args.ledger.reserve(
        args.config.estimate_usd_per_call.judge,
        args.label,
      );
      const result = { ...okResult(labelsReply(args.prompt)), reportedUsd: 0 };
      reservation.settle({
        model: args.modelId,
        usage: result.usage,
        reportedUsd: result.reportedUsd,
      });
      return result;
    });
    const logs = [];
    const summary = await run(stub, { log: (line) => logs.push(line) });
    assert.equal(summary.status, 'done');
    const perModel = {};
    for (const call of stub.calls)
      perModel[call.modelId] = (perModel[call.modelId] || 0) + 1;
    assert.deepEqual(summary.estimated, {
      calls: stub.calls.length,
      models: perModel,
    });
    assert.equal(
      Object.keys(perModel).length,
      Object.keys(config.models.judges).length,
    );
    assert.ok(
      logs.some((line) =>
        line.startsWith(
          `judge: ${stub.calls.length} call(s) charged at the estimate`,
        ),
      ),
    );
  }));

test('a projection equal to max_usd runs; a hundredth of a cent above it refuses', () =>
  withRepo(async ({ layout, run }) => {
    // With every judgment stale, `plan` (which counts a file as done) passes and the job's own projection decides.
    const makeStale = () => {
      for (const name of judgmentFiles(layout, 'items'))
        helpers.update(
          path.join(layout.runDir, 'judgments', 'items', name),
          (record) => {
            record.inputs.input_sha256 = '1'.repeat(64);
          },
        );
    };
    await run(stubJudge());
    makeStale();
    const equal = stubJudge();
    const ran = await run(equal, {
      config: helpers.exampleConfig({ max_usd: 1.9057 }),
    });
    assert.equal(ran.projected_usd, 1.9057);
    assert.equal(ran.status, 'done', JSON.stringify(ran));
    assert.equal(equal.calls.length, 30);
    makeStale();
    const above = stubJudge();
    const refused = await run(above, {
      config: helpers.exampleConfig({ max_usd: 1.9056 }),
    });
    assert.equal(refused.status, 'refused');
    assert.match(refused.refused.join('\n'), /is above max_usd 1\.9056/);
    assert.equal(above.calls.length, 0);
  }));

test('an OpenCode version that cannot be read is a warning, not a stop: the judgments record no version', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge();
    const summary = await run(stub, {
      readVersion: async () => {
        throw new Error(`opencode is not installed (${SECRET})`);
      },
    });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(stub.calls.length, 30);
    const warning = summary.warnings.find((line) =>
      /the OpenCode version could not be read/.test(line),
    );
    assert.match(warning, /opencode is not installed/);
    assert.equal(warning.includes(SECRET), false, warning);
    assert.equal(
      judgmentOf(layout, 'items', TASKS[0], 'xai').inputs.opencode_version,
      null,
    );
  }));

test('a plan above max_usd refuses the job before anything is read or spent', () =>
  withRepo(async ({ layout, config, run }) => {
    helpers.writeLedger(layout.ledgerFile, [
      {
        type: 'settle',
        id: 'x1',
        ts: '2026-11-10T11:00:00.000Z',
        run: layout.runId,
        label: 'earlier',
        usd: config.max_usd - 0.5,
        status: 'ok',
        model: 'claude-sonnet-5-5',
        cost_source: 'reported',
      },
    ]);
    const stub = stubJudge();
    const summary = await run(stub);
    assert.equal(summary.status, 'refused');
    assert.match(summary.refused.join('\n'), /above max_usd/);
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(judgmentFiles(layout, 'items'), []);
  }));

test('a refused plan judges nothing; a skill plan does not run is skipped', () =>
  withRepo(async ({ layout, run }) => {
    helpers.write(layout.tasksFile(SKILL, 'b1'), '{ broken');
    const stub = stubJudge();
    const refused = await run(stub);
    assert.equal(refused.status, 'refused');
    assert.match(refused.refused.join('\n'), /brew-log/);
    assert.equal(stub.calls.length, 0);
  }));

test('a skill without a baseline is skipped and judged nowhere', () =>
  withRepo(async ({ run }) => {
    const stub = stubJudge();
    const summary = await run(stub, { skills: [SKILL, 'pantry-note'] });
    assert.deepEqual(summary.skipped, [
      { skill: 'pantry-note', status: 'no baseline' },
    ]);
    assert.equal(stub.calls.length, 30);
  }));

test('runJudging --dry-run: lists the pending judgments and calls, spends and writes nothing', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge();
    const lines = [];
    let versionRead = false;
    const summary = await run(stub, {
      dryRun: true,
      log: (line) => lines.push(line),
      readVersion: async () => {
        versionRead = true;
        return 'x';
      },
    });
    assert.equal(summary.status, 'dry-run');
    assert.equal(summary.pending, 30);
    // 30 judgments, 10 per seat, each at its seat model's upper estimate (p90).
    assert.equal(summary.projected_usd, roundUsd(10 * P90_PER_SEAT_ROUND));
    assert.equal(summary.projected_usd, 1.9057);
    assert.equal(stub.calls.length, 0);
    assert.equal(versionRead, false);
    assert.equal(lines.filter((line) => /would judge/.test(line)).length, 30);
    assert.equal(fs.existsSync(path.join(layout.runDir, 'judgments')), false);
    assert.equal(fs.existsSync(layout.ledgerFile), false);
  }));

test('a reading B batch whose tasks are stale has no items work; reading A still judges it', () =>
  withRepo(async ({ layout, config, run }) => {
    helpers.update(layout.tasksFile(SKILL, 'b1'), (tasks) => {
      tasks.rules_sha256 = '9'.repeat(64);
    });
    const items = await run(stubJudge());
    assert.equal(items.jobs, 0);
    assert.equal(items.status, 'done');
    // The fixture copy's answers were written before the edit, under the same inputs (the task text is unchanged).
    await writeChecklists(layout, config);
    const outcome = stubJudge();
    const summary = await run(outcome, { scale: 'outcome' });
    assert.equal(summary.jobs, 24);
    assert.equal(outcome.calls.length, 24);
  }));

// ---- failure modes: retries, timeouts, provider blocks, the systemic stop, credentials ---------------------------

const refusal = () =>
  failedResult('provider blocked the response: safeguards flagged it');
const labelOf = (taskId, seat, scale = 'items', arm = 'with') =>
  `${SKILL}/b1/${taskId}:${scale}:${seat}:${arm}`;
const failedRecords = (layout, taskId, seat, arm = 'with') => {
  const file = layout.judgmentFile('items', SKILL, 'b1', taskId, seat, arm);
  const dir = path.dirname(file);
  return fs
    .readdirSync(dir)
    .filter((name) =>
      name.startsWith(`${path.basename(file)}${judgeJob.FAILED_MARK}`),
    )
    .sort()
    .map((name) => helpers.readJson(path.join(dir, name)));
};

test('a failed call is retried with a growing pause; a judgment that then succeeds is valid and says how many tries', () =>
  withRepo(async ({ layout, run }) => {
    const target = labelOf(TASKS[0], 'openai');
    let tries = 0;
    const pauses = [];
    const stub = stubJudge(async (args) => {
      if (args.label === target && ++tries < 3)
        return tries === 1
          ? { ...failedResult('timeout'), timedOut: true }
          : failedResult('ThrottlingException: rate exceeded');
      return okResult(labelsReply(args.prompt));
    });
    const summary = await run(stub, {
      retry: {
        sleep: async (ms) => {
          pauses.push(ms);
        },
        baseMs: 5,
      },
    });
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(stub.calls.filter((call) => call.label === target).length, 3);
    assert.deepEqual(pauses, [5, 10]);
    const record = judgmentOf(layout, 'items', TASKS[0], 'openai');
    assert.equal(record.status, 'valid');
    assert.equal(record.attempts, 3);
    // The three tries are booked; none is free. The two failed tries report no cost and are charged the openai seat
    // model's mean; the third reports 0.005, below that mean for a model whose CLI reports low, so it is charged the
    // mean too.
    assert.equal(
      record.usd,
      roundUsd(3 * SEAT_PRICES.openai.mean),
      String(record.usd),
    );
  }));

test('a judgment that fails every try is kept as .failed-<time>, stays pending, and is tried again by a rerun', () =>
  withRepo(async ({ layout, run }) => {
    const target = labelOf(TASKS[1], 'xai');
    const stub = stubJudge(async (args) =>
      args.label === target
        ? { ...failedResult('timeout'), timedOut: true }
        : okResult(labelsReply(args.prompt)),
    );
    const summary = await run(stub);
    assert.equal(summary.status, 'partial');
    assert.equal(stub.calls.filter((call) => call.label === target).length, 3);
    assert.deepEqual(summary.results.failed, [
      {
        judgment: target,
        kind: 'transient',
        reason: 'the call failed 3 time(s): timeout',
      },
    ]);
    assert.equal(
      fs.existsSync(
        layout.judgmentFile('items', SKILL, 'b1', TASKS[1], 'xai', 'with'),
      ),
      false,
    );
    const [kept] = failedRecords(layout, TASKS[1], 'xai');
    assert.equal(kept.status, 'failed');
    assert.equal(kept.arm, 'with');
    assert.equal(kept.error_kind, 'transient');
    assert.equal(kept.attempts, 3);
    assert.equal(kept.refusals, 0);
    assert.equal(
      kept.usd,
      roundUsd(3 * SEAT_PRICES.xai.mean),
      'the three paid tries are booked on the record',
    );
    assert.equal(summary.pending, 1);
    const again = stubJudge();
    const rerun = await run(again);
    assert.equal(rerun.status, 'done');
    assert.deepEqual(
      again.calls.map((call) => call.label),
      [target],
    );
    assert.equal(
      failedRecords(layout, TASKS[1], 'xai').length,
      1,
      'the failed record is kept',
    );
  }));

test('an invalid reply is retried like a failed call, and the last reply is kept with the failure', () =>
  withRepo(async ({ layout, run }) => {
    const target = labelOf(TASKS[2], 'anthropic');
    const stub = stubJudge(async (args) =>
      args.label === target
        ? okResult('Answer A is better. {"items_a":["MET"]}')
        : okResult(labelsReply(args.prompt)),
    );
    const summary = await run(stub);
    assert.equal(summary.status, 'partial');
    assert.equal(stub.calls.filter((call) => call.label === target).length, 3);
    const [kept] = failedRecords(layout, TASKS[2], 'anthropic');
    assert.equal(kept.invalid_reply, 'not_json');
    assert.equal(kept.raw_text, 'Answer A is better. {"items_a":["MET"]}');
    assert.match(kept.error, /invalid reply \(not_json\)/);
  }));

test('an error that can never work is not retried and does not count toward the systemic stop', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge(async (args) =>
      args.label.includes(':anthropic:')
        ? failedResult('AccessDeniedException: not authorized for this model')
        : okResult(labelsReply(args.prompt)),
    );
    const summary = await run(stub);
    assert.equal(summary.status, 'partial');
    assert.equal(
      failedRecords(layout, TASKS[0], 'anthropic')[0].error_kind,
      'permanent',
    );
    assert.equal(
      summary.stop,
      null,
      'ten permanent failures in a row are no systemic stop',
    );
    assert.equal(
      stub.calls.filter((call) => call.label.includes(':anthropic:')).length,
      10,
    );
    assert.deepEqual(
      [...new Set(summary.results.failed.map((entry) => entry.kind))],
      ['permanent'],
    );
  }));

test('provider blocks count across launches: two in the first, the third makes the judgment refused for good', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    const target = labelOf(TASKS[3], 'openai');
    const blockTarget = (args) =>
      args.label === target ? refusal() : okResult(labelsReply(args.prompt));
    const first = stubJudge(blockTarget);
    const launch1 = await run(first);
    assert.equal(launch1.status, 'partial');
    assert.equal(first.calls.filter((call) => call.label === target).length, 2);
    assert.equal(launch1.results.failed[0].kind, 'refusal');
    assert.equal(failedRecords(layout, TASKS[3], 'openai')[0].refusals, 2);
    assert.equal(launch1.pending, 1);

    const second = stubJudge(blockTarget);
    const launch2 = await run(second);
    assert.deepEqual(
      second.calls.map((call) => call.label),
      [target],
      'only the one block still allowed is tried',
    );
    assert.equal(launch2.status, 'partial');
    assert.deepEqual(
      launch2.results.refused.map((entry) => entry.judgment),
      [target],
    );
    const record = judgmentOf(layout, 'items', TASKS[3], 'openai');
    assert.equal(record.status, 'refused');
    assert.equal(record.refusals, 3);
    assert.deepEqual(
      launch2.blocked.map((entry) => entry.judgment),
      [target],
    );
    assert.match(launch2.warnings.join('\n'), /blocked the judge 3 time\(s\)/);
    // The task still counts with its two other seats.
    const row = launch2.tasks.find((entry) => entry.task_id === TASKS[3]);
    assert.equal(row.counted, true);
    assert.equal(row.seats_valid, 2);

    const third = stubJudge(blockTarget);
    const launch3 = await run(third);
    assert.equal(third.calls.length, 0);
    assert.equal(launch3.status, 'partial');
    assert.equal(launch3.blocked.length, 1);
    const judgeB = buildPlan({ layout, config, skills: [SKILL] }).stages.find(
      (stage) => stage.id === 2,
    ).calls.judgeB;
    assert.deepEqual(judgeB, { done: 30, total: 30 });

    // A new without answer makes its judgments pending, except on the seat whose with judgment is refused: that
    // seat could never count, so it is not judged until the refused judgment's inputs change.
    const { taskSet } = loadTaskSet({ layout, config, skill: SKILL, tmpRoot });
    writeAnswer(layout, {
      batch: 'b1',
      task: taskSet.batches[0].tasks[3],
      arm: 'without',
      text: `${WITHOUT_TEXT} Then a biscuit.`,
    });
    const fourth = stubJudge(blockTarget);
    const launch4 = await run(fourth);
    assert.deepEqual(fourth.calls.map((call) => call.label).sort(), [
      labelOf(TASKS[3], 'anthropic', 'items', 'without'),
      labelOf(TASKS[3], 'xai', 'items', 'without'),
    ]);
    assert.equal(launch4.other_arm_unusable, 1);
    assert.equal(launch4.status, 'partial');
    const { jobs } = judgeJob.planJudging({
      layout,
      config,
      skills: [SKILL],
      scale: 'items',
      judgeInput:
        require('../../../scripts/bench/lib/judge-input').createJudgeInput(),
      armsTmpRoot: tmpRoot,
    });
    const held = jobs.find((entry) => entry.state === 'other_arm_unusable');
    assert.equal(held.label, labelOf(TASKS[3], 'openai', 'items', 'without'));
    assert.match(
      held.reason,
      /the with answer was blocked by the provider for good on this seat/,
    );
    // plan agrees: with no file for the held judgment, it is no call there either.
    fs.unlinkSync(held.file);
    const planned = buildPlan({ layout, config, skills: [SKILL] }).stages.find(
      (stage) => stage.id === 2,
    ).calls.judgeB;
    assert.deepEqual(planned, { done: 29, total: 29 });
  }));

test('a judgment that gets through after blocks is valid; a changed input starts the block count again', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    const target = labelOf(TASKS[4], 'xai');
    await run(
      stubJudge((args) =>
        args.label === target ? refusal() : okResult(labelsReply(args.prompt)),
      ),
    );
    const passed = await run(stubJudge());
    assert.equal(passed.status, 'done');
    assert.equal(judgmentOf(layout, 'items', TASKS[4], 'xai').refusals, 2);

    // The judgment of task 1 is made again and blocked twice: a `.failed-` record of the current inputs says so.
    const blocked = labelOf(TASKS[0], 'anthropic');
    fs.unlinkSync(
      layout.judgmentFile('items', SKILL, 'b1', TASKS[0], 'anthropic', 'with'),
    );
    const earlier = stubJudge((args) =>
      args.label === blocked ? refusal() : okResult(labelsReply(args.prompt)),
    );
    await run(earlier);
    assert.equal(
      earlier.calls.filter((call) => call.label === blocked).length,
      2,
    );
    assert.equal(failedRecords(layout, TASKS[0], 'anthropic')[0].refusals, 2);

    // A new with answer gives that judgment new inputs: the two blocks of the old inputs do not count.
    const { taskSet } = loadTaskSet({ layout, config, skill: SKILL, tmpRoot });
    writeAnswer(layout, {
      batch: 'b1',
      task: taskSet.batches[0].tasks[0],
      arm: 'with',
      text: `${WITH_TEXT} Then a second cup.`,
    });
    const stub = stubJudge((args) =>
      args.label === blocked ? refusal() : okResult(labelsReply(args.prompt)),
    );
    const summary = await run(stub);
    assert.equal(
      stub.calls.filter((call) => call.label === blocked).length,
      2,
      'two blocks allowed again, not one',
    );
    assert.equal(summary.results.refused.length, 0);
  }));

test('the words of an invalid reply never decide how the failure is classed: a reply that names a credential, access or block error is retried and counts toward the systemic stop', () =>
  withRepo(async ({ layout, run }) => {
    for (const word of [
      'ExpiredToken',
      'AccessDenied',
      'provider blocked the response',
    ]) {
      const stub = stubJudge(async (args) =>
        okResult(
          JSON.stringify({
            ...JSON.parse(labelsReply(args.prompt)),
            [word]: 1,
          }),
        ),
      );
      const summary = await run(stub);
      assert.equal(summary.stop && summary.stop.kind, 'systemic', word);
      assert.match(summary.stop.message, /ABORT-SYSTEMIC: 4 calls in a row/);
      assert.ok(summary.results.failed.length >= 1, word);
      for (const failed of summary.results.failed) {
        assert.equal(failed.kind, 'transient', word);
        assert.match(
          failed.reason,
          /the call failed 3 time\(s\): invalid reply \(fields\)/,
        );
        assert.equal(
          stub.calls.filter((call) => call.label === failed.judgment).length,
          3,
          `${word}: every try is made`,
        );
      }
      assert.deepEqual(judgmentFiles(layout, 'items'), []);
      const [, taskId, seat, arm] =
        /\/(brew-log-rules-\d):items:([a-z]+):(with|without)$/.exec(
          summary.results.failed[0].judgment,
        );
      assert.equal(
        failedRecords(layout, taskId, seat, arm).at(-1).error_kind,
        'transient',
        word,
      );
    }
  }));

/** One call wide for every seat, so the calls in flight are known: at most one per seat. */
const ONEWIDE = {
  config: { judge_concurrency: 1, judge_concurrency_by_seat: { xai: 1 } },
};

/**
 * An `answer` for stubJudge that, on its first call, turns `judgments/items` into a dangling link. Reads then see no
 * folder (so the block count is 0) and every write of a result fails with ENOENT, without chmod (a root user ignores it).
 */
function breakStoreOnFirstCall(layout, dir, inner) {
  const link = path.join(layout.runDir, 'judgments', 'items');
  let broken = false;
  const answer = async (args, index) => {
    if (!broken) {
      broken = true;
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(path.join(dir, 'nowhere'), link);
    }
    return inner(args, index);
  };
  return { answer, link };
}

test('a judgment that cannot be stored ends the job: the calls in flight finish, no new call starts, and a rerun resumes', () =>
  withRepo(async ({ dir, layout, run }) => {
    const { answer, link } = breakStoreOnFirstCall(layout, dir, async (args) =>
      okResult(labelsReply(args.prompt)),
    );
    const stub = stubJudge(answer);
    await assert.rejects(run(stub), (error) => error.code === 'ENOENT');
    // Each of the three seats is one call wide: at most three calls were in flight when the first write failed.
    assert.ok(
      stub.calls.length >= 1 && stub.calls.length <= 4,
      stub.calls.length,
    );
    assert.deepEqual(judgmentFiles(layout, 'items'), []);
    fs.unlinkSync(link);
    const again = stubJudge();
    const rerun = await run(again);
    assert.equal(rerun.status, 'done', JSON.stringify(rerun));
    assert.equal(again.calls.length, 30);
  }, ONEWIDE));

test('a failed judgment that cannot be kept ends the job the same way', () =>
  withRepo(async ({ dir, layout, run }) => {
    const { answer } = breakStoreOnFirstCall(layout, dir, async () =>
      failedResult('exit 7: boom'),
    );
    const stub = stubJudge(answer);
    await assert.rejects(run(stub), (error) => error.code === 'ENOENT');
    // Three judgments in flight at most, each tried 3 times.
    assert.ok(stub.calls.length <= 9, stub.calls.length);
  }, ONEWIDE));

test('a provider block that cannot be stored ends the job the same way', () =>
  withRepo(async ({ dir, layout, run }) => {
    const { answer } = breakStoreOnFirstCall(layout, dir, async () =>
      refusal(),
    );
    const stub = stubJudge(answer);
    await assert.rejects(run(stub), (error) => error.code === 'ENOENT');
    assert.ok(stub.calls.length <= 6, stub.calls.length);
  }, ONEWIDE));

test('an error that is neither a stop nor a call failure ends the job once the calls in flight finish', () =>
  withRepo(async ({ layout, run }) => {
    // A result that cannot be written as JSON stands for any bug in the job's own code after a paid call.
    const stub = stubJudge(async (args) => {
      const reply = JSON.parse(labelsReply(args.prompt));
      return { ...okResult(JSON.stringify(reply)), usage: null, ms: 1n };
    });
    await assert.rejects(run(stub), (error) => error instanceof Error);
    assert.ok(stub.calls.length <= 3, stub.calls.length);
    assert.deepEqual(judgmentFiles(layout, 'items'), []);
  }, ONEWIDE));

test('what a failed judgment keeps of the reply and the error is redacted', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    const target = labelOf(TASKS[2], 'anthropic');
    const stub = stubJudge(async (args) =>
      args.label === target
        ? okResult(`The labels are not given. ${SECRET}`)
        : okResult(labelsReply(args.prompt)),
    );
    await run(stub);
    const [kept] = failedRecords(layout, TASKS[2], 'anthropic');
    assert.equal(kept.invalid_reply, 'not_json');
    assert.match(kept.raw_text, /The labels are not given\./);
    assert.equal(kept.raw_text.includes(SECRET), false, kept.raw_text);
    assert.equal(JSON.stringify(kept).includes(SECRET), false);

    // failedRecord redacts on its own, whatever the caller passes in.
    const { jobs } = judgeJob.planJudging({
      layout,
      config,
      skills: [SKILL],
      scale: 'items',
      judgeInput: createJudgeInput(),
      armsTmpRoot: tmpRoot,
    });
    const record = judgeJob.failedRecord(jobs[0], {
      status: 'failed',
      error: Object.assign(new Error(`the call failed: ${SECRET}`), {
        kind: 'transient',
      }),
      refusals: 0,
      attempts: 3,
      last: {
        result: { text: `a reply with ${SECRET}` },
        scored: { valid: false, kind: 'not_json' },
      },
      usd: 0,
      openCodeVersion: null,
      now: () => NOW_MS,
    });
    assert.match(record.error, /the call failed: /);
    assert.equal(record.error.includes(SECRET), false, record.error);
    assert.match(record.raw_text, /a reply with /);
    assert.equal(record.raw_text.includes(SECRET), false, record.raw_text);
  }));

test('two failures of one judgment in the same millisecond keep two records', () =>
  withRepo(async ({ layout, run }) => {
    const target = labelOf(TASKS[1], 'xai');
    const failing = () =>
      stubJudge(async (args) =>
        args.label === target
          ? failedResult('exit 7: boom')
          : okResult(labelsReply(args.prompt)),
      );
    await run(failing());
    await run(failing());
    const file = layout.judgmentFile(
      'items',
      SKILL,
      'b1',
      TASKS[1],
      'xai',
      'with',
    );
    const names = fs
      .readdirSync(path.dirname(file))
      .filter((name) => name.includes(`${path.basename(file)}.failed-`))
      .sort();
    assert.equal(names.length, 2, names.join(', '));
    assert.match(names[0], /\.failed-[^-]+(?:-[^-]+)*$/);
    assert.match(names[1], /-2$/);
    assert.equal(failedRecords(layout, TASKS[1], 'xai').length, 2);
  }));

test('4 judgments in a row that fail every try stop the job (systemic); nothing failed is written as done', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge(async () => failedResult('exit 7: boom'));
    const summary = await run(stub, {
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { xai: 1 },
      }),
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'systemic');
    assert.match(
      summary.stop.message,
      /ABORT-SYSTEMIC: 4 calls in a row failed every try/,
    );
    assert.deepEqual(judgmentFiles(layout, 'items'), []);
    assert.ok(stub.calls.length < 30 * 3, String(stub.calls.length));
    assert.equal(summary.remaining, 30);
  }));

test('the job passes a redactor with the exported values to the ledger, the retry helper and the breaker, so a bare value is removed from a label and from the stop message', () =>
  withRepo(async ({ layout, run }) => {
    const bare = FRESH.secretAccessKey;
    assert.equal(
      redact(bare),
      bare,
      'the module redactor does not know a bare value',
    );
    const labelled = stubJudge(async (args) => {
      (await args.ledger.reserve(0.001, `note ${bare}`)).cancel();
      return okResult(labelsReply(args.prompt));
    });
    const done = await run(labelled);
    assert.equal(done.status, 'done', JSON.stringify(done));
    const ledgerText = fs.readFileSync(layout.ledgerFile, 'utf8');
    assert.ok(ledgerText.includes('note [REDACTED]'), 'the label was written');
    assert.ok(!ledgerText.includes(bare), 'no bare value in the ledger');
  }));

test('permanent failures in a row are no systemic stop', () =>
  withRepo(async ({ run }) => {
    const narrow = {
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { anthropic: 1, openai: 1, xai: 1 },
      }),
    };
    const permanent = stubJudge(async () =>
      failedResult('AccessDeniedException: not authorized for this model'),
    );
    const allPermanent = await run(permanent, narrow);
    assert.equal(allPermanent.stop, null, 'permanent failures never count');
    assert.equal(permanent.calls.length, 30, 'each is tried once');
    assert.equal(allPermanent.results.failed.length, 30);
  }));

test('a failed or a refused record that cannot be written is the I/O error: marked as a write, fatal, and no more calls start', (context) =>
  withRepo(async ({ layout, run }) => {
    if (process.getuid && process.getuid() === 0) {
      context.skip('a root user can write to a read-only folder');
      return;
    }
    const folderOf = (taskId) =>
      path.dirname(
        layout.judgmentFile('items', SKILL, 'b1', taskId, 'anthropic', 'with'),
      );
    const readOnly = async (folder, callback) => {
      fs.chmodSync(folder, 0o500);
      try {
        return await callback();
      } catch (error) {
        return error;
      } finally {
        fs.chmodSync(folder, 0o700);
      }
    };
    // Every call fails, so only failed and refused records are written: nothing else can make the first write error.
    const everyCall = (message) => stubJudge(async () => failedResult(message));
    // A failed judgment: its record cannot be kept.
    fs.mkdirSync(folderOf(TASKS[0]), { recursive: true });
    const failedError = await readOnly(folderOf(TASKS[0]), () =>
      run(everyCall('timeout')),
    );
    assert.equal(failedError.writing, true, String(failedError));
    assert.equal(failedError.fatal, true);
    // A blocked judgment: two launches make it `refused`, and the second cannot write it.
    const blocked = 'The provider blocked the response';
    await run(everyCall(blocked));
    const refusedError = await readOnly(folderOf(TASKS[0]), () =>
      run(everyCall(blocked)),
    );
    assert.equal(refusedError.writing, true, String(refusedError));
  }));

test('a bare exported value in the error of a failed call is removed from the retry error and from the systemic stop message', () =>
  withRepo(async ({ layout, run }) => {
    const bare = FRESH.secretAccessKey;
    const stub = stubJudge(async () => ({
      ...failedResult(`exit 7: ${bare}`),
      text: `the judge printed ${bare}`,
    }));
    const summary = await run(stub, {
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { xai: 1 },
      }),
    });
    assert.equal(summary.stop.kind, 'systemic');
    assert.match(
      summary.stop.message,
      /\(last: the call failed 3 time\(s\): exit 7: \[REDACTED\]\)/,
    );
    const everything = JSON.stringify(summary);
    assert.ok(!everything.includes(bare), 'no bare value in the summary');
    for (const file of fs.readdirSync(layout.runDir, { recursive: true })) {
      const full = path.join(layout.runDir, String(file));
      if (fs.statSync(full).isFile())
        assert.ok(
          !fs.readFileSync(full, 'utf8').includes(bare),
          `${file} holds no bare value`,
        );
    }
  }));

test('a valid reply that quotes a bare exported value is kept with the value removed', () =>
  withRepo(async ({ layout, run }) => {
    const bare = FRESH.secretAccessKey;
    const stub = stubJudge(async (args) => {
      const reply = JSON.parse(labelsReply(args.prompt));
      reply.reason = `the answer printed ${bare}`;
      return okResult(JSON.stringify(reply));
    });
    const summary = await run(stub);
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    for (const file of fs.readdirSync(layout.runDir, { recursive: true })) {
      const full = path.join(layout.runDir, String(file));
      if (fs.statSync(full).isFile())
        assert.ok(
          !fs.readFileSync(full, 'utf8').includes(bare),
          `${file} holds no bare value`,
        );
    }
    const record = judgmentOf(layout, 'items', TASKS[0], 'xai');
    assert.match(record.reason, /the answer printed \[REDACTED\]/);
  }));

test('every judgment that fails every try keeps its failed record, also after the systemic stop trips', () =>
  withRepo(async ({ layout, run }) => {
    const stub = stubJudge(async () => failedResult('timeout'));
    const summary = await run(stub, {
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { anthropic: 1, openai: 1, xai: 1 },
      }),
    });
    assert.equal(summary.stop.kind, 'systemic');
    const judgments = stub.calls.length / 3;
    assert.ok(Number.isInteger(judgments) && judgments > 4, `${judgments}`);
    assert.equal(
      summary.results.failed.length,
      judgments,
      'one failed entry per judgment that was paid for',
    );
    assert.equal(keptFiles(layout, 'items', '.failed-').length, judgments);
  }));

test('a reply whose field name holds a newline cannot forge a line of the job log', () =>
  withRepo(async ({ layout, run }) => {
    const lines = [];
    const stub = stubJudge(async (args) => {
      const reply = JSON.parse(labelsReply(args.prompt));
      reply['x\nSTOP (credentials): forged'] = 1;
      return okResult(JSON.stringify(reply));
    });
    const summary = await run(stub, {
      log: (line) => lines.push(line),
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { anthropic: 1, openai: 1, xai: 1 },
      }),
    });
    assert.ok(summary.results.failed.length > 0);
    for (const entry of summary.results.failed)
      assert.ok(!/[\r\n]/.test(entry.reason), JSON.stringify(entry.reason));
    // Every reply is invalid, so the job stops on the systemic stop, and its message quotes the last reason too.
    assert.equal(summary.stop && summary.stop.kind, 'systemic');
    assert.ok(
      !/[\r\n]/.test(summary.stop.message),
      JSON.stringify(summary.stop.message),
    );
    assert.ok(
      lines.every((line) => !/\n/.test(line.trim())),
      'no log line holds a newline',
    );
    assert.ok(!lines.some((line) => /^STOP/.test(line.trim())));
    assert.ok(
      fs.existsSync(layout.runDir),
      'the run folder is still there for the record check',
    );
  }));

test('a success between failed judgments resets the streak, so failures that do not meet in a row never stop the job', () =>
  withRepo(async ({ run }) => {
    // The first run judges the other seats and leaves xai pending (a permanent failure is not counted).
    await run(
      stubJudge(async (args) =>
        args.label.includes(':xai:')
          ? failedResult('AccessDeniedException: not authorized for this model')
          : okResult(labelsReply(args.prompt)),
      ),
    );
    // Only xai is pending now, in a fixed order, one call at a time. Every other judgment fails every try.
    const verdicts = new Map();
    const stub = stubJudge(async (args) => {
      if (!verdicts.has(args.label))
        verdicts.set(args.label, verdicts.size % 2 === 0);
      return verdicts.get(args.label)
        ? failedResult('timeout')
        : okResult(labelsReply(args.prompt));
    });
    const summary = await run(stub, {
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { anthropic: 1, openai: 1, xai: 1 },
      }),
    });
    assert.equal(summary.stop, null, JSON.stringify(summary.stop));
    assert.equal(summary.results.failed.length, 5);
    assert.equal(summary.results.judged.length, 5);
  }));

test('an ineligible record that cannot be written is the "cannot write" error, and no call is made', () =>
  withRepo(async ({ layout, config, tmpRoot, run }) => {
    writeAnswers(layout, config, tmpRoot, (arm, taskId) =>
      taskId === TASKS[0] && arm === 'without'
        ? 'I loaded the brew-log skill. Tea.'
        : arm === 'with'
          ? WITH_TEXT
          : WITHOUT_TEXT,
    );
    fs.mkdirSync(layout.runDir, { recursive: true });
    fs.writeFileSync(path.join(layout.runDir, 'judgments'), 'not a folder');
    const stub = stubJudge();
    await assert.rejects(run(stub), (error) => error.writing === true);
    assert.equal(stub.calls.length, 0);
  }));

test('storing marks a system error as a write and leaves any other error unmarked', () => {
  const system = Object.assign(new Error('boom'), {
    code: 'ENOSPC',
    syscall: 'write',
  });
  assert.throws(
    () =>
      judgeJob.storing(() => {
        throw system;
      }),
    (error) => error === system && error.writing === true,
  );
  const bug = new TypeError('bug');
  assert.throws(
    () =>
      judgeJob.storing(() => {
        throw bug;
      }),
    (error) => error === bug && error.writing === undefined,
  );
  assert.equal(
    judgeJob.storing(() => 'kept'),
    'kept',
  );
});

test("priorRefusals: the most that a kept record of today's inputs says, not the sum; a record without a whole count or of other inputs is not counted", () =>
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'task.anthropic.with.json');
    const job = { file, inputs: { input_sha256: 'today' } };
    const keep = (suffix, record) =>
      helpers.write(`${file}.failed-${suffix}`, record);
    assert.equal(judgeJob.priorRefusals(job), 0, 'nothing kept');
    keep('a', { inputs: { input_sha256: 'today' }, refusals: 1 });
    keep('b', { inputs: { input_sha256: 'today' }, refusals: 1 });
    assert.equal(judgeJob.priorRefusals(job), 1, 'the maximum, not the sum');
    keep('c', { inputs: { input_sha256: 'today' }, refusals: 2 });
    assert.equal(judgeJob.priorRefusals(job), 2);
    keep('d', { inputs: { input_sha256: 'yesterday' }, refusals: 5 });
    assert.equal(judgeJob.priorRefusals(job), 2, 'other inputs start again');
    keep('e', { inputs: { input_sha256: 'today' } });
    keep('f', { inputs: { input_sha256: 'today' }, refusals: '9' });
    keep('g', { inputs: { input_sha256: 'today' }, refusals: 1.5 });
    assert.equal(judgeJob.priorRefusals(job), 2, 'no whole count, no vote');
    assert.equal(
      judgeJob.priorRefusals({
        file: path.join(dir, 'other.xai.with.json'),
        inputs: { input_sha256: 'today' },
      }),
      0,
      'another judgment',
    );
  }));

test('a judgment that was stale and is then blocked for good keeps the stale file as .superseded-<time>', () =>
  withRepo(async ({ layout, run }) => {
    await run(stubJudge());
    // A new answer for the with arm makes its judgments stale; the redo is blocked every time.
    const target = labelOf(TASKS[0], 'anthropic');
    helpers.update(
      layout.answerFile(SKILL, 'b1', TASKS[0], 'with'),
      (record) => {
        record.text = `${record.text} Also noted: the cup was warm.`;
        record.answer_sha256 = sha256(record.text);
      },
    );
    const blocked = stubJudge(async (args) =>
      args.label === target
        ? failedResult('The provider blocked the response')
        : okResult(labelsReply(args.prompt)),
    );
    for (let launch = 0; launch < 2; launch += 1) await run(blocked);
    assert.ok(
      keptFiles(layout, 'items', '.superseded-').some((name) =>
        name.includes(`${TASKS[0]}.anthropic.with.json.superseded-`),
      ),
      'the stale judgment is kept next to the refused one',
    );
    assert.equal(
      judgmentOf(layout, 'items', TASKS[0], 'anthropic', 'with').status,
      'refused',
    );
  }));

test('credentials within 3 minutes of expiry start no call; a credential error from a call stops at once, not retried', () =>
  withRepo(async ({ layout, run }) => {
    // A call that never checks the guard itself: the job's own check at the start is what refuses.
    let started = 0;
    let versionRead = false;
    const early = await run(
      {
        judgeCall: async (args) => {
          started += 1;
          return okResult(labelsReply(args.prompt));
        },
      },
      {
        getCredentials: async () => ({
          ...FRESH,
          expiration: new Date(NOW_MS + 2 * 60 * 1000).toISOString(),
        }),
        readVersion: async () => {
          versionRead = true;
          return 'v';
        },
      },
    );
    assert.equal(early.status, 'stopped');
    assert.equal(early.stop.kind, 'credentials');
    assert.match(early.stop.message, /less than 3 minutes away/);
    assert.equal(started, 0);
    assert.equal(versionRead, false);

    // The clock passes the margin during the run: the guard refuses the next call before it starts.
    let clock = NOW_MS;
    const expiring = stubJudge(async (args) => {
      clock += 60 * 60 * 1000;
      return okResult(labelsReply(args.prompt));
    });
    const during = await run(expiring, {
      now: () => clock,
      config: helpers.exampleConfig({
        judge_concurrency: 1,
        judge_concurrency_by_seat: { xai: 1 },
      }),
    });
    assert.equal(during.stop.kind, 'credentials');
    assert.equal(
      expiring.calls.length,
      3,
      'one call per seat, then the clock is past the margin',
    );
    assert.equal(judgmentFiles(layout, 'items').length, 3);

    const target = labelOf(TASKS[2], 'xai');
    let targetCalls = 0;
    const expired = stubJudge(async (args) => {
      if (args.label === target) {
        targetCalls += 1;
        return failedResult(
          'ExpiredTokenException: The security token included in the request is expired',
        );
      }
      return okResult(labelsReply(args.prompt));
    });
    const stopped = await run(expired);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.stop.kind, 'credentials');
    assert.equal(targetCalls, 1);
    assert.equal(
      fs.existsSync(
        layout.judgmentFile('items', SKILL, 'b1', TASKS[2], 'xai', 'with'),
      ),
      false,
    );
    assert.deepEqual(failedRecords(layout, TASKS[2], 'xai'), []);
  }));

test('no credentials are exported when no call is needed: ineligible answers and current judgments only', () =>
  withRepo(
    async ({ layout, config, tmpRoot, run }) => {
      writeAnswers(
        layout,
        config,
        tmpRoot,
        () => 'I loaded the brew-log skill. Tea.',
      );
      let exported = 0;
      const summary = await run(stubJudge(), {
        getCredentials: async () => {
          exported += 1;
          throw new Error('must not export');
        },
      });
      assert.equal(summary.status, 'done', JSON.stringify(summary));
      assert.equal(summary.results.ineligible.length, 30);
      assert.equal(exported, 0);
    },
    { answers: false },
  ));

test('the default judge call: every judgment goes through OpenCode in a locked-down private sandbox that is removed', () =>
  withRepo(async ({ dir, layout, run }) => {
    const sandboxRoot = path.join(dir, 'judge-tmp');
    fs.mkdirSync(sandboxRoot, { mode: 0o700 });
    const seen = [];
    const runStub = async (command, args, options) => {
      // The --help probe: this stub is an OpenCode that has --standalone.
      if (args.length === 2 && args[1] === '--help')
        return {
          code: 0,
          stdout: 'opencode run\n  --format  format\n  --standalone  private\n',
          stderr: '',
          ms: 1,
          timedOut: false,
        };
      const config = JSON.parse(
        fs.readFileSync(path.join(options.cwd, 'opencode.json'), 'utf8'),
      );
      seen.push({
        command,
        args,
        cwd: options.cwd,
        mode: fs.statSync(path.dirname(options.cwd)).mode & 0o777,
        config,
        env: options.env,
      });
      const prompt = args.at(-1);
      const text = labelsReply(prompt);
      const stdout = [
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_stub1',
          part: { type: 'text', text },
        }),
        JSON.stringify({
          type: 'step_finish',
          sessionID: 'ses_stub1',
          part: {
            type: 'step-finish',
            tokens: { input: 1000, output: 100 },
            cost: 0.01,
          },
        }),
      ].join('\n');
      return {
        code: 0,
        stdout,
        stderr: '',
        ms: 3,
        timedOut: false,
        overflow: false,
      };
    };
    const summary = await run(
      { judgeCall: undefined },
      {
        judgeCall: require('../../../scripts/bench/lib/opencode').judgeCall,
        callOptions: {
          run: runStub,
          tmpRoot: sandboxRoot,
          baseEnv: {
            PATH: '/usr/bin:/bin',
            HOME: dir,
            ANTHROPIC_API_KEY: 'stale',
            AWS_PROFILE: 'bench',
          },
        },
      },
    );
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(seen.length, 30);
    for (const call of seen) {
      assert.equal(call.command, 'opencode');
      assert.deepEqual(call.args.slice(0, 5), [
        'run',
        '--standalone',
        '--format',
        'json',
        '--auto',
      ]);
      assert.ok(call.cwd.startsWith(path.join(sandboxRoot, 'bench-judge-')));
      assert.equal(call.mode, 0o700);
      assert.equal(call.config.permission['*'], 'deny');
      assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
      // The keys the job exported reach every call; the shell's profile does not.
      assert.equal(call.env.AWS_ACCESS_KEY_ID, FRESH.accessKeyId);
      assert.equal(call.env.AWS_SECRET_ACCESS_KEY, FRESH.secretAccessKey);
      assert.equal(call.env.AWS_SESSION_TOKEN, FRESH.sessionToken);
      assert.equal(call.env.AWS_PROFILE, undefined);
      assert.equal(
        call.env.XDG_CONFIG_HOME.startsWith(path.dirname(call.cwd)),
        true,
      );
    }
    assert.deepEqual(
      fs.readdirSync(sandboxRoot),
      [],
      'every sandbox is removed',
    );
    const totals = readLedger(layout.ledgerFile);
    assert.equal(totals.calls, 30);
    assert.equal(totals.reserved, 0);
    const record = judgmentOf(layout, 'items', TASKS[0], 'anthropic');
    assert.equal(record.usage_source, 'stream');
  }));

// ---- buckets and task gaps ------------------------------------------------------------------------------------------

test('a judgment records the score of the one answer it saw, with that answer arm', () => {
  const { scoreJudgment } = require('../../../scripts/bench/lib/judge-scale');
  for (const arm of ['with', 'without']) {
    const scored = scoreJudgment({
      scale: 'outcome',
      text: JSON.stringify({ items: ['MET', 'PARTIAL'], reason: 'item 2' }),
      arm,
      itemCount: 2,
    });
    assert.equal(scored.valid, true);
    assert.equal(scored.arm, arm);
    assert.deepEqual(scored.labels, ['MET', 'PARTIAL']);
    assert.ok(!('delta' in scored) && !('order' in scored));
  }
});

test('itemBuckets: the bucket of each item in order; a missing entry is an error, not a guess', () => {
  const buckets = helpers.goodBuckets();
  assert.deepEqual(judgeJob.itemBuckets(buckets, `${SKILL}-rules-1`, 5), [
    'value',
    'value',
    'format',
    'guard',
    'value',
  ]);
  assert.throws(
    () => judgeJob.itemBuckets(buckets, 'nope', 5),
    /no entry for task nope/,
  );
  assert.throws(
    () => judgeJob.itemBuckets(buckets, `${SKILL}-rules-1`, 6),
    /no bucket for item 6/,
  );
  // An entry that is not an object with a text bucket is no bucket: the same error, whatever it holds.
  for (const entry of [
    null,
    'value',
    { rule_id: 'rule-1' },
    { bucket: 7 },
    { bucket: null },
  ])
    assert.throws(
      () =>
        judgeJob.itemBuckets(
          { scenarios: { t1: { 1: { bucket: 'value' }, 2: entry } } },
          't1',
          2,
        ),
      /no bucket for item 2 of task t1/,
      JSON.stringify(entry),
    );
  for (const items of [null, [], 'value', 7])
    assert.throws(
      () => judgeJob.itemBuckets({ scenarios: { t1: items } }, 't1', 1),
      /no entry for task t1/,
      JSON.stringify(items),
    );
});

test('taskGaps: a task counts with 2 of 3 seats valid for both arms; a seat with one valid arm is left out, never 0', () => {
  // scores[seat] is [with, without]; undefined is a judgment not made yet.
  const jobsFor = (taskId, scores) =>
    scores.flatMap((pair, index) =>
      ['with', 'without'].map((arm, armIndex) => {
        const score = pair[armIndex];
        return {
          skill: SKILL,
          batch: 'b1',
          task: { id: taskId },
          scale: 'items',
          seat: SEATS[index],
          arm,
          state: score === undefined ? 'pending' : 'done',
          file: null,
          record:
            score === undefined
              ? null
              : {
                  seat: SEATS[index],
                  scale: 'items',
                  arm,
                  status: 'valid',
                  score,
                  guard: null,
                },
        };
      }),
    );
  const jobs = [
    ...jobsFor('t1', [
      [3, 2],
      [4, 2],
      [5, undefined],
    ]),
    ...jobsFor('t2', [
      [3, 2],
      [undefined, 2],
      [5, undefined],
    ]),
  ];
  const rows = judgeJob.taskGaps(jobs, {
    readRecord: (entry) => entry.record,
  });
  assert.deepEqual(
    rows.map((row) => [row.task_id, row.counted, row.gap, row.seats_valid]),
    [
      ['t1', true, 1.5, 2],
      ['t2', false, null, 1],
    ],
  );
});

test('taskGaps: a record that names another seat or arm than its job is left out, and the row says so', () => {
  const jobOf = (seat, arm, record) => ({
    skill: SKILL,
    batch: 'b1',
    task: { id: 't1' },
    scale: 'items',
    seat,
    arm,
    state: 'done',
    record,
  });
  const valid = (seat, arm, score) => ({
    seat,
    scale: 'items',
    arm,
    status: 'valid',
    score,
    guard: null,
  });
  const readRecord = (entry) => entry.record;
  // Three seats judged both arms, but the file of xai's `with` judgment holds a second anthropic `with` judgment
  // (score 5). Left in, it would replace anthropic's own score and the gap would be 2.5.
  const misfiled = [
    jobOf('anthropic', 'with', valid('anthropic', 'with', 3)),
    jobOf('anthropic', 'without', valid('anthropic', 'without', 2)),
    jobOf('openai', 'with', valid('openai', 'with', 4)),
    jobOf('openai', 'without', valid('openai', 'without', 2)),
    jobOf('xai', 'with', valid('anthropic', 'with', 5)),
    jobOf('xai', 'without', valid('xai', 'without', 2)),
  ];
  const [counted] = judgeJob.taskGaps(misfiled, { readRecord });
  assert.deepEqual(
    [counted.counted, counted.gap, counted.seats_valid, counted.invalid],
    [true, 1.5, 2, null],
  );
  // A record with the right seat and the wrong arm is left out the same way, and two seats are then not enough.
  const wrongArm = [
    jobOf('anthropic', 'with', valid('anthropic', 'with', 3)),
    jobOf('anthropic', 'without', valid('anthropic', 'without', 2)),
    jobOf('openai', 'with', valid('openai', 'without', 4)),
    jobOf('openai', 'without', valid('openai', 'without', 2)),
  ];
  const [short] = judgeJob.taskGaps(wrongArm, { readRecord });
  assert.equal(short.counted, false);
  assert.equal(short.gap, null);
  assert.equal(short.seats_valid, 1);
  assert.match(
    short.invalid,
    /1 valid seat\(s\), need 2; the judgment of openai with names another seat or arm than its job/,
  );
  // An ineligible record under another seat's name still keeps the task from counting.
  const ineligibleMisfiled = misfiled.map((entry) =>
    entry.seat === 'xai' && entry.arm === 'with'
      ? {
          ...entry,
          record: { ...entry.record, seat: 'openai', status: 'ineligible' },
        }
      : entry,
  );
  const [blocked] = judgeJob.taskGaps(ineligibleMisfiled, { readRecord });
  assert.equal(blocked.counted, false);
  assert.equal(blocked.gap, null);
  assert.match(
    blocked.invalid,
    /the ineligible judgment of xai with names another seat or arm than its job/,
  );
});

test('taskGaps before any record is written: a planned ineligible job leaves its task out with the reason', () => {
  // The plan of a first launch: the without answer of t1 is ineligible and nothing is on disk yet, so only the job
  // state can tell; t2 has three seats valid for both arms.
  const jobOf = (taskId, seat, arm, state, extra = {}) => ({
    skill: SKILL,
    batch: 'b1',
    task: { id: taskId },
    scale: 'items',
    seat,
    arm,
    state,
    reason: null,
    ...extra,
  });
  const valid = (seat, arm, score) => ({
    seat,
    scale: 'items',
    arm,
    status: 'valid',
    score,
    guard: null,
  });
  const jobs = [
    ...SEATS.flatMap((seat) => [
      jobOf('t1', seat, 'with', 'other_arm_unusable'),
      jobOf('t1', seat, 'without', 'ineligible', {
        reason: 'the without answer is not eligible: leak',
      }),
    ]),
    ...SEATS.flatMap((seat) => [
      jobOf('t2', seat, 'with', 'done', { record: valid(seat, 'with', 4) }),
      jobOf('t2', seat, 'without', 'done', {
        record: valid(seat, 'without', 3),
      }),
    ]),
  ];
  const rows = judgeJob.taskGaps(jobs, {
    readRecord: (entry) => entry.record,
  });
  assert.deepEqual(
    rows.map((row) => [row.task_id, row.counted, row.gap, row.invalid]),
    [
      ['t1', false, null, 'the without answer is not eligible: leak'],
      ['t2', true, 1, null],
    ],
  );
});

// ---- job.js and the launcher ----------------------------------------------------------------------------------------

/** Runs job.js main on `root` with the judge stub; returns { code, out, err, last }. */
async function runJobMain(argv, judgeOptions) {
  const out = [];
  const err = [];
  const code = await job.main(
    argv,
    { out: (text) => out.push(text), err: (text) => err.push(text) },
    { judgeOptions },
  );
  const lines = out.join('').trim().split('\n');
  return {
    code,
    out: out.join(''),
    err: err.join(''),
    last:
      code === 0 || code === 3 || code >= 4 ? JSON.parse(lines.at(-1)) : null,
  };
}

/** judgeOptions for job main: the stub call, made-up fresh credentials, no retry pause, the arms in the temp folder. */
const jobOptions = (tmpRoot, judgeCall) => ({
  judgeCall,
  readVersion: async () => 'v',
  getCredentials: async () => FRESH,
  now: () => NOW_MS,
  retry: { sleep: async () => {}, baseMs: 0 },
  armsTmpRoot: tmpRoot,
});

test('job main judge: exit 0 and a last line with the reading counts; exit 3 when judgments wait', () =>
  withRepo(async ({ layout, tmpRoot }) => {
    const options = (stub) => jobOptions(tmpRoot, stub.judgeCall);
    const argv = (scale) => [
      'judge',
      '--scale',
      scale,
      '--skills',
      SKILL,
      '--root',
      layout.root,
    ];
    const done = await runJobMain(argv('items'), options(stubJudge()));
    assert.equal(done.code, 0, done.out + done.err);
    assert.ok(
      !/not counted/.test(done.out),
      'every task counts, so no task line is printed',
    );
    assert.match(done.out, /^judge: run default, skills brew-log, scale items/);
    assert.equal(done.last.job, 'judge');
    assert.equal(done.last.scale, 'items');
    assert.equal(done.last.status, 'done');
    assert.equal(done.last.jobs, 30);
    assert.equal(done.last.tasks_counted, 5);
    assert.deepEqual(done.last.results, {
      judged: 30,
      ineligible: 0,
      failed: 0,
      refused: 0,
    });
    assert.equal(done.last.blocked, 0);
    // Nothing is judged yet on a dry run, so every task would "not count": no task lines are printed.
    const dry = await runJobMain(
      [...argv('outcome'), '--dry-run'],
      options(stubJudge()),
    );
    assert.equal(dry.code, 0, dry.out + dry.err);
    assert.ok(!/^task /m.test(dry.out), 'a dry run prints no task lines');
    const waiting = await runJobMain(argv('outcome'), options(stubJudge()));
    assert.equal(waiting.code, 3);
    assert.equal(waiting.last.status, 'partial');
    assert.equal(waiting.last.waiting, 24);
    assert.equal(waiting.last.excluded, 1);
    const notCounted = waiting.out
      .split('\n')
      .filter((line) => line.startsWith('task '));
    assert.equal(notCounted.length, waiting.last.tasks, 'one line per task');
    assert.match(
      notCounted[0],
      /^task brew-log\/b1\/brew-log-rules-1: not counted: 0 valid seat\(s\), need 2$/,
    );
    assert.ok(
      notCounted.every((line) => !line.endsWith(': ')),
      'every line has a reason',
    );
  }));

test('job main judge: a judgment folder that cannot be written is exit 74 with "cannot write", and it stops the paid calls', (context) =>
  withRepo(async ({ layout, tmpRoot }) => {
    if (process.getuid && process.getuid() === 0) {
      context.skip('a root user can write to a read-only folder');
      return;
    }
    const folder = path.join(layout.runDir, 'judgments');
    fs.mkdirSync(folder, { recursive: true });
    fs.chmodSync(folder, 0o500);
    try {
      let calls = 0;
      const out = [];
      const err = [];
      const code = await job.main(
        ['judge', '--scale', 'items', '--skills', SKILL, '--root', layout.root],
        { out: (text) => out.push(text), err: (text) => err.push(text) },
        {
          judgeOptions: jobOptions(tmpRoot, async (args) => {
            calls += 1;
            return okResult(labelsReply(args.prompt));
          }),
        },
      );
      assert.equal(code, 74, out.join('') + err.join(''));
      assert.match(err.join(''), /cannot write/);
      assert.ok(calls < 30, `${calls} calls`);
    } finally {
      fs.chmodSync(folder, 0o700);
    }
  }));

test('job main judge: a spend stop is exit 5 and a failed judgment is printed by name', () =>
  withRepo(async ({ layout, tmpRoot }) => {
    const argv = [
      'judge',
      '--scale',
      'items',
      '--skills',
      SKILL,
      '--root',
      layout.root,
    ];
    const spend = await runJobMain(
      argv,
      jobOptions(tmpRoot, async () => {
        throw new SpendStopError('max_usd reached', 'max_usd');
      }),
    );
    assert.equal(spend.code, 5, spend.out + spend.err);
    assert.match(spend.out, /STOP \(spend\): SPEND STOP: max_usd reached/);
    const failed = await runJobMain(
      argv,
      jobOptions(tmpRoot, async (args) =>
        args.label.includes(`${TASKS[0]}:items:anthropic:`)
          ? failedResult('exit 1: boom')
          : okResult(labelsReply(args.prompt)),
      ),
    );
    assert.equal(failed.code, 3);
    assert.match(
      failed.out,
      /failed: brew-log\/b1\/brew-log-rules-1:items:anthropic:with: the call failed 3 time\(s\): exit 1: boom/,
    );
  }));

test('job main judge: a judgment the provider blocked for good is printed by name, with the count on the last line', () =>
  withRepo(async ({ layout, tmpRoot }) => {
    const argv = [
      'judge',
      '--scale',
      'items',
      '--skills',
      SKILL,
      '--root',
      layout.root,
    ];
    const target = `${TASKS[0]}:items:anthropic:with`;
    const options = jobOptions(tmpRoot, async (args) =>
      args.label.endsWith(target)
        ? refusal()
        : okResult(labelsReply(args.prompt)),
    );
    // Two blocks in the first launch, the third in the second: the judgment is refused for good.
    const first = await runJobMain(argv, options);
    assert.equal(first.code, 3, first.out + first.err);
    assert.equal(first.last.blocked, 0);
    const second = await runJobMain(argv, options);
    assert.equal(second.code, 3, second.out + second.err);
    assert.equal(second.last.blocked, 1);
    assert.equal(second.last.results.refused, 1);
    assert.match(
      second.out,
      /blocked by the provider: brew-log\/b1\/brew-log-rules-1:items:anthropic:with: the provider blocked the judge 3 time\(s\)/,
    );
  }));

test('launcher: a judge job of each scale has its own log and pid file, so one never stands for the other', () =>
  withRepo(async ({ layout }) => {
    const started = [];
    const start = (command, args) => {
      started.push(args);
      return 4000 + started.length;
    };
    const processCheck = {
      kill: () => true,
      runSync: () => ({ status: 0, stdout: launchLib.JOB_SCRIPT }),
    };
    const request = (scale) =>
      launchLib.resolveJobRequest('judge', {
        skills: SKILL,
        root: layout.root,
        scale,
      });
    const items = launchLib.launchJob(request('items'), {
      start,
      processCheck,
    });
    assert.equal(items.scale, 'items');
    assert.match(path.basename(items.pid_file), /^judge-items\.brew-log\.pid$/);
    const outcome = launchLib.launchJob(request('outcome'), {
      start,
      processCheck,
    });
    assert.equal(outcome.already_running, false);
    assert.match(
      path.basename(outcome.log_file),
      /^judge-outcome\.brew-log\.log$/,
    );
    assert.deepEqual(started[1].slice(-2), ['--scale', 'outcome']);
    const again = launchLib.launchJob(request('items'), {
      start,
      processCheck,
    });
    assert.equal(again.already_running, true);
    assert.equal(again.pid, items.pid);
    assert.equal(started.length, 2);
    // A pairs job for the same skill is a job of another kind: it is not refused by the judge jobs.
    const pairs = launchLib.launchJob(
      launchLib.resolveJobRequest('pairs', {
        skills: SKILL,
        root: layout.root,
      }),
      { start, processCheck },
    );
    assert.equal(pairs.already_running, false);
    assert.equal(launchLib.fileJobName(request('outcome')), 'judge-outcome');
  }));

test('the judge job runs the statuses the pairs job runs: one shared set', () => {
  assert.equal(judgeJob.RUNNABLE_STATUSES, RUNNABLE_STATUSES);
  assert.deepEqual([...judgeJob.RUNNABLE_STATUSES].sort(), [
    'ready',
    'rules stale',
    'tasks stale',
  ]);
});
