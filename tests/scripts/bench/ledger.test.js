// SPDX-License-Identifier: Apache-2.0
// Tests for the spend ledger (scripts/bench/lib/ledger.js): limits, reservation then replacement, the lock, and a
// two-process race. A fake clock drives time; no paid call, no network. The race test uses real child processes.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  createLedger,
  readLedger,
  checkLimits,
  settledCost,
  reservationFor,
  readLedgerRows,
  LOCK_WAIT_MARGIN_MS,
  LedgerError,
  SpendStopError,
} = require('../../../scripts/bench/lib/ledger');
const helpers = require('./helpers');

const START_MS = Date.parse('2026-01-15T10:00:00Z');
const SAMPLE = path.join(helpers.FIXTURE_DIR, 'ledger.sample.jsonl');
const TEST_LIMITS = { max_usd: 10, total_cap_usd: 20 };

/** A ledger in `dir` on a fake clock whose sleep only moves the clock. `clock.slept` lists the pauses. */
function makeLedger(dir, overrides = {}) {
  const clock = {
    nowMs: START_MS,
    slept: [],
    now: () => clock.nowMs,
    sleep: async (delayMs) => (
      (clock.nowMs += delayMs),
      clock.slept.push(delayMs)
    ),
  };
  let idCounter = 0;
  const runId = overrides.runId ?? 'r1';
  const file = path.join(dir, 'out', 'ledger.jsonl');
  const ledger = createLedger({
    file,
    limits: TEST_LIMITS,
    runId,
    now: clock.now,
    sleep: clock.sleep,
    newId: () => `${runId}-${++idCounter}`,
    ...overrides,
  });
  return { clock, file, lock: `${file}.lock`, ...ledger };
}
const makeSettledRow = (usd, run = 'r1') => ({
  type: 'settle',
  id: `s${usd}${run}`,
  ts: '2026-01-15T09:00:00Z',
  run,
  usd,
});
const readRows = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

test('the sample ledger fixture totals: settled spend, live reservations, an expired one, and per run', () => {
  const ledgerState = readLedger(SAMPLE, { now: () => START_MS });
  // a1 is replaced by its settle row. a3 is a reservation that expired without a settle row: its $0.50 counts as spent,
  // and the reader says how many there were.
  assert.deepEqual(
    [ledgerState.total, ledgerState.reserved, ledgerState.calls],
    [0.875, 0.75, 2],
  );
  assert.deepEqual(ledgerState.expired, { count: 1, usd: 0.5 });
  assert.deepEqual(
    [...ledgerState.runs],
    [
      ['r1', { spent: 0.125, reserved: 0.25 }],
      ['r2', { spent: 0.75, reserved: 0.5 }],
    ],
  );
  assert.equal(
    readLedger(SAMPLE, { now: () => START_MS + 3600e3 }).reserved,
    0,
    'every reservation expires',
  );
});

// [name, limits, { runUsd, totalUsd, callUsd }, expected limit]
const LIMIT_CASES = [
  [
    'under every limit',
    TEST_LIMITS,
    { runUsd: 1, totalUsd: 5, callUsd: 1 },
    null,
  ],
  [
    'exactly at max_usd is allowed',
    TEST_LIMITS,
    { runUsd: 9, totalUsd: 9, callUsd: 1 },
    null,
  ],
  [
    'exactly at every limit is allowed',
    { max_usd: 1, total_cap_usd: 1 },
    { runUsd: 0.5, totalUsd: 0.5, callUsd: 0.5 },
    null,
  ],
  [
    'above max_usd (this run)',
    TEST_LIMITS,
    { runUsd: 9.5, totalUsd: 9.5, callUsd: 1 },
    'max_usd',
  ],
  [
    'above total_cap_usd with this run under max_usd',
    TEST_LIMITS,
    { runUsd: 1, totalUsd: 19.5, callUsd: 1 },
    'total_cap_usd',
  ],
  [
    'above total_cap_usd when it is the lower limit (limits out of order)',
    { max_usd: 30, total_cap_usd: 20 },
    { runUsd: 1, totalUsd: 19.5, callUsd: 1 },
    'total_cap_usd',
  ],
  [
    'both above: max_usd is named first',
    { max_usd: 1, total_cap_usd: 2 },
    { runUsd: 9, totalUsd: 9, callUsd: 1 },
    'max_usd',
  ],
  [
    'total_cap_usd counts the ledger total, not this run: a small run in a full ledger is refused',
    { max_usd: 10, total_cap_usd: 2 },
    { runUsd: 1, totalUsd: 9, callUsd: 1 },
    'total_cap_usd',
  ],
];
for (const [name, limits, spend, expected] of LIMIT_CASES) {
  test(`checkLimits: ${name}`, () =>
    assert.equal(checkLimits(limits, spend)?.limit ?? null, expected));
}

test('reserve refuses at each limit with a SPEND STOP error, and writes nothing when it refuses', async () => {
  // Seed: run r1 has spent 8 and run r2 has spent 10, so the ledger holds 18 of total_cap_usd 20.
  const cases = [
    [
      'max_usd',
      { call: 3 },
      /this run to \$11\.00, above max_usd \$10\.00 \(\$18\.00 spent/,
    ],
    [
      'total_cap_usd',
      { call: 2.5, limits: { ...TEST_LIMITS, max_usd: 15 } },
      /the ledger to \$20\.50, above total_cap_usd \$20\.00/,
    ],
    [
      'total_cap_usd',
      // The other run's 10 counts: this run alone (8 + 7.5) is under both limits.
      { call: 7.5, limits: { max_usd: 25, total_cap_usd: 25 } },
      /the ledger to \$25\.50, above total_cap_usd \$25\.00/,
    ],
  ];
  for (const [limit, { call, limits }, message] of cases) {
    await helpers.withTmpAsync(async (dir) => {
      const ledger = makeLedger(dir, limits ? { limits } : {});
      helpers.writeLedger(ledger.file, [
        makeSettledRow(8),
        makeSettledRow(10, 'r2'),
      ]);
      const before = fs.readFileSync(ledger.file, 'utf8');
      await assert.rejects(
        ledger.reserve(call, 'judge task-1'),
        (error) =>
          error instanceof SpendStopError &&
          error.limit === limit &&
          error.fatal === true &&
          /^SPEND STOP: judge task-1 would take/.test(error.message) &&
          message.test(error.message),
      );
      assert.equal(
        fs.readFileSync(ledger.file, 'utf8'),
        before,
        `${limit}: the refused call left no row`,
      );
      assert.equal(
        fs.existsSync(ledger.lock),
        false,
        `${limit}: the lock was released`,
      );
    });
  }
});

test('live reservations count against the limits, so two calls started together cannot both pass', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir, {
      limits: { max_usd: 100, total_cap_usd: 5 },
    });
    await ledger.reserve(3);
    await assert.rejects(ledger.reserve(3), { limit: 'total_cap_usd' });
    const other = makeLedger(dir, {
      runId: 'r2',
      limits: { max_usd: 100, total_cap_usd: 5 },
    });
    await assert.rejects(
      other.reserve(3),
      { limit: 'total_cap_usd' },
      'another run sees the first run reservation',
    );
    await other.reserve(2); // exactly at the limit
  });
});

test('a reservation is replaced by the cost the CLI reported, or keeps its reserved cost when there is no usable cost', async () => {
  const usage = {
    input_tokens: 1000000,
    output_tokens: 500000,
    cache_read_tokens: 2000000,
    secret: 'dropped',
  };
  // [name, settle argument, expected usd, expected cost_source]
  const cases = [
    [
      'reported cost is charged',
      { model: 'claude-sonnet-5-5', usage, reportedUsd: 9 },
      9,
      'reported',
    ],
    [
      'a reported cost below the reservation is charged as reported',
      { model: 'claude-sonnet-5-5', usage, reportedUsd: 0.5 },
      0.5,
      'reported',
    ],
    [
      'no reported cost: the reserved cost stays',
      { model: 'claude-sonnet-5-5', usage },
      2,
      'estimate',
    ],
    [
      'a NaN cost: the reserved cost stays',
      { model: 'claude-sonnet-5-5', usage, reportedUsd: Number.NaN },
      2,
      'estimate',
    ],
    [
      'a negative cost: the reserved cost stays',
      { model: 'claude-sonnet-5-5', usage, reportedUsd: -1 },
      2,
      'estimate',
    ],
    [
      'a cost that is not a number: the reserved cost stays',
      { model: 'claude-sonnet-5-5', usage, reportedUsd: '9' },
      2,
      'estimate',
    ],
    [
      'zero while the usage shows tokens: the reserved cost stays',
      { model: 'claude-sonnet-5-5', usage, reportedUsd: 0 },
      2,
      'estimate',
    ],
    [
      'zero with no tokens is a reported $0',
      { model: 'claude-sonnet-5-5', usage: {}, reportedUsd: 0 },
      0,
      'reported',
    ],
    ['no usage at all: the reserved cost stays', {}, 2, 'estimate'],
  ];
  for (const [name, settleArgument, expectedUsd, costSource] of cases) {
    await helpers.withTmpAsync(async (dir) => {
      const ledger = makeLedger(dir);
      const reservation = await ledger.reserve(2, 'call');
      assert.deepEqual(
        [ledger.read().total, ledger.read().reserved],
        [0, 2],
        `${name}: reserved, not yet spent`,
      );
      reservation.settle(settleArgument);
      const ledgerState = ledger.read();
      assert.ok(
        Math.abs(ledgerState.total - expectedUsd) < 1e-9 &&
          ledgerState.reserved === 0 &&
          ledgerState.calls === 1,
        `${name}: total ${ledgerState.total}, reserved ${ledgerState.reserved}`,
      );
      const row = readRows(ledger.file).at(-1);
      assert.equal(row.cost_source, costSource, name);
      assert.equal(Object.hasOwn(row, 'priced'), false, name);
      assert.deepEqual(
        Object.keys(row.tokens ?? {}).sort(),
        settleArgument.usage && Object.keys(settleArgument.usage).length
          ? ['cache_read_tokens', 'input_tokens', 'output_tokens']
          : [],
        `${name}: only token counts are stored`,
      );
    });
  }
});

test('settledCost: the reported cost when it can be used, else the reservation', () => {
  const tokens = { output_tokens: 10 };
  assert.deepEqual(
    settledCost({ reportedUsd: 0.3, usage: tokens, reservedUsd: 1 }),
    { usd: 0.3, cost_source: 'reported' },
  );
  for (const reportedUsd of [
    undefined,
    null,
    Number.NaN,
    Infinity,
    -0.1,
    '0.3',
  ])
    assert.deepEqual(
      settledCost({ reportedUsd, usage: tokens, reservedUsd: 1 }),
      { usd: 1, cost_source: 'estimate' },
      String(reportedUsd),
    );
  assert.deepEqual(
    settledCost({ reportedUsd: 0, usage: tokens, reservedUsd: 1 }),
    { usd: 1, cost_source: 'estimate' },
  );
  assert.deepEqual(
    settledCost({
      reportedUsd: 0,
      usage: { output_tokens: 0 },
      reservedUsd: 1,
    }),
    { usd: 0, cost_source: 'reported' },
  );
});

test('settledCost: with no usable cost the mean is charged; a model whose CLI reports low is charged at least its mean', () => {
  const tokens = { output_tokens: 10 };
  // The mean, not the reservation (the p90), is charged when the cost cannot be used.
  assert.deepEqual(
    settledCost({ usage: tokens, reservedUsd: 0.02052, meanUsd: 0.01336 }),
    { usd: 0.01336, cost_source: 'estimate' },
  );
  // cliReportsLow: a GPT judge call reporting 0.0009 is charged its mean 0.01336, marked "floor".
  assert.deepEqual(
    settledCost({
      reportedUsd: 0.0009,
      usage: tokens,
      reservedUsd: 0.02052,
      meanUsd: 0.01336,
      cliReportsLow: true,
    }),
    { usd: 0.01336, cost_source: 'floor' },
  );
  // A reported cost above the mean is kept, also for such a model.
  assert.deepEqual(
    settledCost({
      reportedUsd: 0.05,
      usage: tokens,
      reservedUsd: 0.02052,
      meanUsd: 0.01336,
      cliReportsLow: true,
    }),
    { usd: 0.05, cost_source: 'reported' },
  );
  // Without cliReportsLow a low reported cost is charged as reported.
  assert.deepEqual(
    settledCost({
      reportedUsd: 0.0009,
      usage: tokens,
      reservedUsd: 0.02052,
      meanUsd: 0.01336,
    }),
    { usd: 0.0009, cost_source: 'reported' },
  );
});

test('reservationFor: a call reserves its p90 from the cost profile and names its kind, model, mean and cliReportsLow', () => {
  const config = helpers.exampleConfig();
  const terra = config.models.judges.openai;
  assert.deepEqual(reservationFor(config, 'judge', terra), {
    usd: 0.02052,
    options: {
      kind: 'judge',
      model: terra,
      meanUsd: 0.01336,
      cliReportsLow: true,
    },
  });
  assert.deepEqual(
    reservationFor(config, 'subject', config.models.subject).options,
    {
      kind: 'subject',
      model: config.models.subject,
      meanUsd: 0.06693,
      cliReportsLow: false,
    },
  );
  assert.equal(
    reservationFor(config, 'subject', config.models.subject).usd,
    0.12123,
  );
  // A model with no entry: estimate_usd_per_call as the mean, 1.5 times it as the p90.
  const fallback = reservationFor(config, 'writer', 'no-history-model');
  assert.equal(fallback.usd, config.estimate_usd_per_call.writer * 1.5);
  assert.equal(fallback.options.meanUsd, config.estimate_usd_per_call.writer);
});

test('a reservation made with reservationFor writes kind and model on both rows and settles at the mean or the floor', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const file = path.join(dir, 'ledger.jsonl');
    const ledger = createLedger({
      file,
      limits: { max_usd: 30, total_cap_usd: 100 },
      runId: 'r',
    });
    const config = helpers.exampleConfig();
    const terra = config.models.judges.openai;
    const price = reservationFor(config, 'judge', terra);
    const low = await ledger.reserve(price.usd, 'low', price.options);
    low.settle({ usage: { output_tokens: 5 }, reportedUsd: 0.0009 });
    const none = await ledger.reserve(price.usd, 'none', price.options);
    none.settle({ ok: false });
    const cancelled = await ledger.reserve(price.usd, 'cancel', price.options);
    cancelled.cancel();
    const rows = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    for (const row of rows) {
      assert.equal(row.kind, 'judge', `${row.type} ${row.label}`);
      assert.equal(row.model, terra, `${row.type} ${row.label}`);
    }
    const reserves = rows.filter((row) => row.type === 'reserve');
    assert.deepEqual(
      reserves.map((row) => row.usd),
      [0.02052, 0.02052, 0.02052],
    );
    const settles = rows.filter((row) => row.type === 'settle');
    assert.deepEqual(
      settles.map((row) => [row.label, row.usd, row.cost_source]),
      [
        ['low', 0.01336, 'floor'],
        ['none', 0.01336, 'estimate'],
        ['cancel', 0, undefined],
      ],
    );
    // A plain reservation (no options) still writes no kind or model, and keeps its amount as the mean.
    const plain = await ledger.reserve(0.5, 'plain');
    plain.settle({});
    const last = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-2);
    for (const line of last) assert.equal('kind' in JSON.parse(line), false);
    assert.equal(JSON.parse(last[1]).usd, 0.5);
    await assert.rejects(
      ledger.reserve(0.5, 'bad', { meanUsd: -1 }),
      /reserve: the mean cost must be a number, 0 or more/,
    );
  });
});

test('readLedgerRows: every row in file order; a missing file is an error', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'ledger.jsonl');
    assert.throws(() => readLedgerRows(file), /ENOENT/);
    const rows = [
      {
        type: 'reserve',
        id: 'a',
        ts: '2026-01-15T09:00:00Z',
        run: 'r',
        usd: 1,
        expires: '2999-01-01T00:00:00Z',
      },
      {
        type: 'settle',
        id: 'a',
        ts: '2026-01-15T09:00:01Z',
        run: 'r',
        usd: 0.5,
        status: 'ok',
      },
    ];
    helpers.writeLedger(file, rows);
    assert.deepEqual(
      readLedgerRows(file).map((row) => [row.type, row.id]),
      [
        ['reserve', 'a'],
        ['settle', 'a'],
      ],
    );
  });
});

test('settle, cancel and failure rows; a reservation closes once; an expired reservation stops counting', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    const cancelledReservation = await ledger.reserve(2);
    cancelledReservation.cancel();
    assert.deepEqual(
      [
        ledger.read().total,
        ledger.read().calls,
        readRows(ledger.file).at(-1).status,
      ],
      [0, 1, 'cancelled'],
    );
    assert.throws(
      () => cancelledReservation.settle({ reportedUsd: 1 }),
      /already settled or cancelled/,
    );
    const failedReservation = await ledger.reserve(2);
    failedReservation.settle({ reportedUsd: 1, ok: false });
    assert.deepEqual(
      [ledger.read().total, readRows(ledger.file).at(-1).status],
      [1, 'failed'],
      'a failed call is still paid for',
    );

    await ledger.reserve(4, 'never settled', { ttlMs: 5000 });
    assert.equal(ledger.read().reserved, 4);
    ledger.clock.nowMs += 5001;
    assert.equal(
      ledger.read().reserved,
      0,
      'a crashed job stops holding money back after its ttl',
    );
  });
});

test('the file and folder are private, and rows carry run, id and an ISO time', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    (await ledger.reserve(1, 'x'.repeat(300))).cancel();
    assert.deepEqual(
      [
        fs.statSync(ledger.file).mode & 0o777,
        fs.statSync(path.dirname(ledger.file)).mode & 0o777,
      ],
      [0o600, 0o700],
    );
    const [reserveRow, settleRow] = readRows(ledger.file);
    assert.deepEqual(
      [
        reserveRow.type,
        reserveRow.run,
        reserveRow.id,
        reserveRow.ts,
        reserveRow.label.length,
        reserveRow.expires,
      ],
      [
        'reserve',
        'r1',
        'r1-1',
        '2026-01-15T10:00:00.000Z',
        120,
        '2026-01-15T10:12:00.000Z',
      ],
    );
    assert.deepEqual([settleRow.type, settleRow.id], ['settle', 'r1-1']);
  });
});

test('readLedger: a missing file is empty, an unfinished last line is skipped, any other bad line fails closed', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'ledger.jsonl');
    assert.deepEqual([readLedger(file).total, readLedger(file).calls], [0, 0]);
    const line = `${JSON.stringify(makeSettledRow(2))}\n`;
    fs.writeFileSync(file, `${line}{"type":"settle","id":"half`);
    assert.equal(readLedger(file).total, 2);
    const badLedgers = [
      ['not JSON in the middle', `${line}oops\n${line}`],
      ['not a ledger row', `${line}{"type":"note"}\n`],
      [
        'a negative amount',
        `${JSON.stringify({ ...makeSettledRow(1), usd: -1 })}\n`,
      ],
      [
        'a reserve row with no expiry',
        `${JSON.stringify({ type: 'reserve', id: 'q', usd: 1 })}\n`,
      ],
    ];
    for (const [name, text] of badLedgers) {
      fs.writeFileSync(file, text);
      assert.throws(
        () => readLedger(file),
        (error) =>
          error instanceof LedgerError &&
          error.fatal &&
          /corrupt ledger line/.test(error.message),
        name,
      );
    }
  });
});

test('the lock: a held lock is waited for, a lock never released refuses the call, a stale lock is broken', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir, { lockTimeoutMs: 200 });
    const holdLock = () => (
      fs.mkdirSync(path.dirname(ledger.file), { recursive: true }),
      fs.writeFileSync(ledger.lock, '1\n'),
      fs.utimesSync(ledger.lock, START_MS / 1000, START_MS / 1000)
    );

    holdLock();
    let polls = 0;
    const waiting = makeLedger(dir, {
      lockTimeoutMs: 200,
      now: ledger.clock.now,
      sleep: async (delayMs) => (
        await ledger.clock.sleep(delayMs),
        ++polls === 3 && fs.rmSync(ledger.lock)
      ),
    });
    await waiting.reserve(1);
    assert.equal(polls, 3, 'it waited for the holder to let go');
    assert.equal(fs.existsSync(ledger.lock), false);

    holdLock();
    const paused = ledger.clock.slept.length;
    await assert.rejects(
      ledger.reserve(1, 'judge'),
      (error) =>
        error instanceof SpendStopError &&
        error.limit === 'lock' &&
        /cannot take the ledger lock .* within 200 ms; no paid call was started/.test(
          error.message,
        ),
    );
    assert.deepEqual(
      [ledger.clock.slept.length - paused, readRows(ledger.file).length],
      [10, 1],
      'it polled until the timeout and wrote nothing (the one row is the earlier call)',
    );
    assert.equal(
      fs.existsSync(ledger.lock),
      true,
      'a lock held by someone else is left alone',
    );

    fs.utimesSync(
      ledger.lock,
      (START_MS - 61000) / 1000,
      (START_MS - 61000) / 1000,
    );
    await ledger.reserve(1);
    assert.deepEqual(
      [fs.existsSync(ledger.lock), readRows(ledger.file).length],
      [false, 2],
      'a lock older than 60 s is a crashed holder',
    );
  });
});

test('several processes reserving together: exactly as many pass as the limit allows, and the lock is gone after', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const file = path.join(dir, 'out', 'ledger.jsonl');
    const ready = path.join(dir, 'ready');
    const startFile = path.join(dir, 'go');
    fs.mkdirSync(ready);
    const child = path.join(__dirname, 'ledger-child.js');
    const results = Array.from(
      { length: 8 },
      (_entry, i) =>
        new Promise((resolve, reject) => {
          const childProcess = spawn(process.execPath, [
            child,
            file,
            `c${i}`,
            ready,
            startFile,
          ]);
          let output = '';
          childProcess.stdout.on('data', (chunk) => (output += chunk));
          childProcess.on('error', reject);
          childProcess.on('close', (code) =>
            code === 0
              ? resolve(JSON.parse(output))
              : reject(new Error(`child ${i} exited ${code}`)),
          );
        }),
    );
    const deadline = Date.now() + 10000;
    while (fs.readdirSync(ready).length < 8 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    fs.writeFileSync(startFile, '');
    const outcomes = await Promise.all(results);
    assert.deepEqual(
      [
        outcomes.filter((result) => result.ok).length,
        outcomes.filter((result) => result.limit === 'total_cap_usd').length,
      ],
      [3, 5],
      JSON.stringify(outcomes),
    );
    assert.deepEqual(
      [
        readLedger(file).reserved,
        readRows(file).length,
        fs.existsSync(`${file}.lock`),
      ],
      [3, 3, false],
    );
  });
});

test('a label is redacted before it is written or shown in a refusal', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const key = ['AK', 'IA'].join('') + 'Q'.repeat(16);
    const ledger = makeLedger(dir, {
      limits: { max_usd: 1, total_cap_usd: 1 },
    });
    (await ledger.reserve(0.5, `judge ${key}`)).cancel();
    await assert.rejects(ledger.reserve(5, `judge ${key}`), (error) =>
      error.message.includes('judge [REDACTED_AWS_KEY_ID] would take'),
    );
    assert.ok(!fs.readFileSync(ledger.file, 'utf8').includes(key));
  });
});

test('createLedger and reserve validate their arguments', async () => {
  for (const limits of [
    undefined,
    // The limit names that total_cap_usd replaced are not read: without total_cap_usd the limits are invalid.
    { max_usd: 1, stop_usd: 1, hard_cap_usd: 1 },
    { ...TEST_LIMITS, total_cap_usd: 0 },
    { ...TEST_LIMITS, total_cap_usd: NaN },
  ]) {
    assert.throws(
      () => createLedger({ file: 'x', limits, runId: 'r' }),
      TypeError,
      JSON.stringify(limits),
    );
  }
  await helpers.withTmpAsync(async (dir) => {
    for (const invalidAmount of [-1, NaN, '2', undefined])
      await assert.rejects(makeLedger(dir).reserve(invalidAmount), TypeError);
  });
});

// Calls with no usable reported cost are charged their reservation, and the ledger says so: `cost_source: "estimate"`
// on the row, and readLedger totals those rows per model.
test('calls charged at the estimate are marked so and totalled per model; reported and cancelled calls are not', async () => {
  const gptModel = 'us.openai.gpt-6.1-terra';
  const usage = { input_tokens: 1e6 };
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    (await ledger.reserve(0.5, 'judge a')).settle({ model: gptModel, usage });
    (await ledger.reserve(0.25, 'judge b')).settle({
      model: gptModel,
      usage,
      reportedUsd: 0,
    });
    (await ledger.reserve(0.125, 'judge c')).settle({
      model: 'other-model',
      usage,
    });
    (await ledger.reserve(1, 'subject')).settle({
      model: 'claude-sonnet-5-5',
      usage,
      reportedUsd: 0.75,
    });
    (await ledger.reserve(2, 'never started')).cancel();
    const written = readRows(ledger.file).filter(
      (row) => row.type === 'settle',
    );
    assert.deepEqual(
      written.map((row) => row.cost_source),
      ['estimate', 'estimate', 'estimate', 'reported', undefined],
    );
    const ledgerState = ledger.read();
    assert.deepEqual(ledgerState.estimated, {
      calls: 3,
      usd: 0.5 + 0.25 + 0.125,
      models: {
        [gptModel]: { calls: 2, usd: 0.75 },
        'other-model': { calls: 1, usd: 0.125 },
      },
    });
    assert.equal(
      ledgerState.calls,
      5,
      'every settled call is still in the ledger total',
    );
  });
});

test('readLedger: no estimated rows gives zero totals; a row with no model is listed under a placeholder', () => {
  assert.deepEqual(
    readLedger(path.join(helpers.FIXTURE_DIR, 'absent.jsonl')).estimated,
    { calls: 0, usd: 0, models: {} },
  );
  const ledgerState = readLedger(SAMPLE, { now: () => START_MS });
  assert.deepEqual(ledgerState.estimated, {
    calls: 1,
    usd: 0.25,
    models: { '(no model recorded)': { calls: 1, usd: 0.25 } },
  });
});

// ---- a call with no usable cost is never settled at $0
test('a call that ended before a model step started, with no cost and no tokens, is charged 0 with cost_source none', async () => {
  assert.deepEqual(
    settledCost({ reservedUsd: 0.5, meanUsd: 0.2, modelStarted: false }),
    { usd: 0, cost_source: 'none' },
  );
  // Tokens or a usable reported cost mean a model was reached, whatever the flag says.
  assert.deepEqual(
    settledCost({
      reservedUsd: 0.5,
      meanUsd: 0.2,
      usage: { input_tokens: 10 },
      modelStarted: false,
    }),
    { usd: 0.2, cost_source: 'estimate' },
  );
  assert.deepEqual(
    settledCost({
      reservedUsd: 0.5,
      meanUsd: 0.2,
      reportedUsd: 0.03,
      modelStarted: false,
    }),
    { usd: 0.03, cost_source: 'reported' },
  );
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    (await ledger.reserve(0.5, 'judge bad flag')).settle({
      model: 'claude-sonnet-5-5',
      ok: false,
      modelStarted: false,
    });
    (await ledger.reserve(0.5, 'judge timed out')).settle({
      model: 'claude-sonnet-5-5',
      ok: false,
    });
    const [unstarted, estimated] = readRows(ledger.file).filter(
      (row) => row.type === 'settle',
    );
    assert.deepEqual(
      [unstarted.usd, unstarted.cost_source, unstarted.status],
      [0, 'none', 'failed'],
    );
    assert.deepEqual([estimated.usd, estimated.cost_source], [0.5, 'estimate']);
    const ledgerState = ledger.read();
    assert.equal(ledgerState.total, 0.5);
    assert.equal(ledgerState.calls, 2);
    assert.deepEqual(ledgerState.unstarted, { calls: 1 });
    assert.equal(ledgerState.estimated.calls, 1);
    assert.deepEqual(ledgerState.byRun.get(unstarted.run), {
      estimated: { calls: 1, usd: 0.5 },
      unstarted: { calls: 1 },
    });
  });
});

test('readLedger: byRun counts the estimated and unstarted calls of each run apart', () =>
  helpers.withTmpAsync(async (dir) => {
    const first = makeLedger(dir, { runId: 'r1' });
    const second = makeLedger(dir, { runId: 'r2' });
    (await first.reserve(0.5, 'a')).settle({ model: 'm' });
    (await first.reserve(0.5, 'b')).settle({ model: 'm' });
    (await second.reserve(0.25, 'c')).settle({ model: 'm' });
    (await second.reserve(0.25, 'd')).settle({
      model: 'm',
      modelStarted: false,
    });
    const ledgerState = first.read();
    assert.deepEqual(ledgerState.byRun.get('r1'), {
      estimated: { calls: 2, usd: 1 },
      unstarted: { calls: 0 },
    });
    assert.deepEqual(ledgerState.byRun.get('r2'), {
      estimated: { calls: 1, usd: 0.25 },
      unstarted: { calls: 1 },
    });
    assert.equal(ledgerState.estimated.calls, 3);
    assert.equal(
      readLedger(path.join(helpers.FIXTURE_DIR, 'absent.jsonl')).byRun.size,
      0,
    );
  }));
const UNUSABLE_USAGE = [
  ['an empty object', {}],
  ['a count written as text', { input_tokens: '1000000' }],
  ['a negative count', { input_tokens: -5 }],
  ['NaN counts', { input_tokens: NaN, output_tokens: NaN }],
  ['an infinite count', { input_tokens: Infinity }],
  ['counts that are all zero', { input_tokens: 0, output_tokens: 0 }],
  ['only fields that are not token counts', { total_tokens: 1000000 }],
];
test('settle with no reported cost keeps the reservation and marks the row as an estimate, whatever the usage', async () => {
  for (const [name, usage] of UNUSABLE_USAGE)
    await helpers.withTmpAsync(async (dir) => {
      const ledger = makeLedger(dir);
      (await ledger.reserve(0.5, 'judge')).settle({
        model: 'claude-sonnet-5-5',
        usage,
      });
      const row = readRows(ledger.file).pop();
      assert.deepEqual([row.usd, row.cost_source], [0.5, 'estimate'], name);
      const ledgerState = ledger.read();
      assert.deepEqual(
        [ledgerState.total, ledgerState.estimated.calls],
        [0.5, 1],
        `${name}: counted, and shown as an estimate`,
      );
    });
});

test('calls with unusable usage still count against the limits: with usage {}, the third $1 call is the last that fits in $3', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir, {
      limits: { max_usd: 3, total_cap_usd: 3 },
    });
    let refused = 0;
    for (let call = 0; call < 10; call++) {
      try {
        (await ledger.reserve(1, `call ${call}`)).settle({
          model: 'claude-sonnet-5-5',
          usage: {},
        });
      } catch (error) {
        if (!(error instanceof SpendStopError)) throw error;
        refused += 1;
      }
    }
    assert.deepEqual([refused, ledger.read().total], [7, 3]);
  });
});

// ---- the lock belongs to the job that took it
test('a holder whose lock was broken while it was paused cancels its reservation and leaves the new holder lock alone', async (t) => {
  await helpers.withTmpAsync(async (dir) => {
    const limits = { max_usd: 1, total_cap_usd: 1 };
    const ledger = makeLedger(dir, { limits });
    const otherToken = 'other-job-token\n';
    const realAppend = fs.appendFileSync;
    let tookOver = false;
    // Another job breaks the stale lock, takes its own and reserves $1, while this one is inside its write.
    const appendMock = t.mock.method(
      fs,
      'appendFileSync',
      (file, data, options) => {
        if (!tookOver && String(data).includes('"type":"reserve"')) {
          tookOver = true;
          fs.writeFileSync(ledger.lock, otherToken);
          realAppend(
            file,
            `${JSON.stringify({ type: 'reserve', id: 'other-1', ts: '2026-01-15T10:00:00.000Z', run: 'r2', label: 'other job', usd: 1, expires: new Date(START_MS + 600000).toISOString() })}\n`,
          );
        }
        return realAppend(file, data, options);
      },
    );
    await assert.rejects(
      ledger.reserve(1, 'this job'),
      (error) =>
        error instanceof SpendStopError &&
        error.limit === 'lock' &&
        /taken over .* cancelled and no paid call was started/.test(
          error.message,
        ),
    );
    appendMock.mock.restore();
    assert.equal(
      fs.readFileSync(ledger.lock, 'utf8'),
      otherToken,
      'the new holder lock was not removed by the old holder',
    );
    const ledgerState = readLedger(ledger.file, { now: ledger.clock.now });
    assert.equal(
      ledgerState.reserved,
      1,
      'only the other job reservation stands, so the $1 limit holds',
    );
    assert.deepEqual(
      readRows(ledger.file).map((row) => [row.id, row.type, row.status]),
      [
        ['other-1', 'reserve', undefined],
        ['r1-1', 'reserve', undefined],
        ['r1-1', 'settle', 'cancelled'],
      ],
    );
  });
});

// ---- a waiter outlasts the stale age
test('a lock left by a crashed holder is broken and the call goes through, instead of failing after 10 s', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    fs.mkdirSync(path.dirname(ledger.file), { recursive: true });
    fs.writeFileSync(ledger.lock, '1\n');
    // 30 s old, and stale after 60 s: the waiter has to wait about 30 s more, which is longer than the old 10 s.
    fs.utimesSync(
      ledger.lock,
      (START_MS - 30000) / 1000,
      (START_MS - 30000) / 1000,
    );
    await ledger.reserve(1, 'after a crash');
    const waitedMs = ledger.clock.slept.reduce((sum, ms) => sum + ms, 0);
    assert.ok(waitedMs > 30000 && waitedMs < 31000, `waited ${waitedMs} ms`);
    assert.equal(fs.existsSync(ledger.lock), false);
    assert.equal(readRows(ledger.file).length, 1);
  });
});

test('the wait for a lock is the stale age plus the margin, whatever the stale age is, so the two cannot drift apart', async () => {
  for (const lockStaleMs of [100, 5000, 60000]) {
    await helpers.withTmpAsync(async (dir) => {
      const ledger = makeLedger(dir, { lockStaleMs });
      fs.mkdirSync(path.dirname(ledger.file), { recursive: true });
      // A lock dated in the future never becomes stale, so the waiter has to give up.
      fs.writeFileSync(ledger.lock, '1\n');
      fs.utimesSync(ledger.lock, START_MS / 1000 + 1e6, START_MS / 1000 + 1e6);
      await assert.rejects(
        ledger.reserve(1, 'waiting'),
        (error) =>
          error instanceof SpendStopError &&
          error.limit === 'lock' &&
          error.message.includes(
            `within ${lockStaleMs + LOCK_WAIT_MARGIN_MS} ms`,
          ),
        `stale ${lockStaleMs}`,
      );
      const waitedMs = ledger.clock.nowMs - START_MS;
      assert.ok(
        waitedMs >= lockStaleMs + LOCK_WAIT_MARGIN_MS &&
          waitedMs < lockStaleMs + LOCK_WAIT_MARGIN_MS + 100,
        `stale ${lockStaleMs}: waited ${waitedMs} ms`,
      );
    });
  }
});

// ---- a last line cut short does not ruin the ledger
test('a torn last line is ended and marked by the next write, so the ledger stays readable and no row is lost', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    await ledger.reserve(1, 'first');
    fs.appendFileSync(ledger.file, '{"type":"settle","id":"half'); // a write that was cut short
    assert.equal(ledger.read().reserved, 1, 'a reader skips the fragment');
    const second = await ledger.reserve(1, 'second');
    const ledgerState = ledger.read();
    assert.equal(ledgerState.reserved, 2, 'the second row was not lost');
    second.settle({ model: 'x' });
    await ledger.reserve(1, 'third');
    assert.equal(ledger.read().reserved, 2);
    assert.match(
      fs.readFileSync(ledger.file, 'utf8'),
      /"half\n\{"type":"torn"[^\n]*\}\n\{"ts":[^\n]*"id":"r1-2"/,
    );
  });
});

test('a corrupt line in the middle of the ledger that no write ended is still refused', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    await ledger.reserve(1, 'first');
    fs.appendFileSync(
      ledger.file,
      `not json\n${JSON.stringify(makeSettledRow(2))}\n`,
    );
    assert.throws(() => ledger.read(), /corrupt ledger line 2/);
    await assert.rejects(ledger.reserve(1, 'second'), LedgerError);
  });
});

// ---- a reservation that never settled
test('a reservation that expired without a settle row counts as spent, is reported, and stops counting once it is settled', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    const reservation = await ledger.reserve(9, 'crashed job');
    ledger.clock.nowMs += 13 * 60 * 1000; // past the 12-minute expiry
    let ledgerState = ledger.read();
    assert.deepEqual(
      [ledgerState.total, ledgerState.reserved, ledgerState.expired],
      [9, 0, { count: 1, usd: 9 }],
    );
    assert.deepEqual(ledgerState.runs.get('r1'), { spent: 9, reserved: 0 });
    await assert.rejects(ledger.reserve(2, 'next'), { limit: 'max_usd' });
    reservation.cancel(); // a late settle row replaces the reservation
    ledgerState = ledger.read();
    assert.deepEqual(
      [ledgerState.total, ledgerState.expired],
      [0, { count: 0, usd: 0 }],
    );
  });
});

// ---- the refusal text
test('a refusal shows the amounts with enough decimals to tell them apart', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    await assert.rejects(
      ledger.reserve(10.004, 'big'),
      (error) =>
        error.limit === 'max_usd' &&
        /^SPEND STOP: big would take this run to \$10\.004, above max_usd \$10\.000 /.test(
          error.message,
        ),
    );
    await assert.rejects(
      ledger.reserve(10.5, 'big'),
      /to \$10\.50, above max_usd \$10\.00 /,
    );
  });
});

// ---- a call that costs more than its reservation
test('a call charged more than its reservation is recorded at its cost, marked, and settle names the limit now passed', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir, {
      limits: { max_usd: 2, total_cap_usd: 20 },
    });
    const usage = { input_tokens: 10 };
    const cheap = await ledger.reserve(1, 'cheap');
    assert.deepEqual(cheap.settle({ usage, reportedUsd: 0.5 }), {
      usd: 0.5,
      cost_source: 'reported',
      over_reservation_usd: 0,
      limit_passed: null,
    });
    assert.equal(
      Object.hasOwn(readRows(ledger.file).at(-1), 'over_reservation_usd'),
      false,
    );
    const costly = await ledger.reserve(1, 'costly');
    const result = costly.settle({ usage, reportedUsd: 5 });
    assert.deepEqual([result.usd, result.limit_passed], [5, 'max_usd']);
    assert.ok(Math.abs(result.over_reservation_usd - 4) < 1e-9);
    assert.ok(
      Math.abs(readRows(ledger.file).at(-1).over_reservation_usd - 4) < 1e-9,
    );
    assert.equal(ledger.read().total, 5.5);
    await assert.rejects(ledger.reserve(0.01, 'next'), { limit: 'max_usd' });
  });
});

test("max_usd counts this run's live reservations: a second 0.6 reservation under max_usd 1 is refused", async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir, {
      limits: { max_usd: 1, total_cap_usd: 100 },
    });
    await ledger.reserve(0.6, 'first');
    await assert.rejects(ledger.reserve(0.6, 'second'), (error) => {
      assert.ok(error instanceof SpendStopError);
      assert.equal(error.limit, 'max_usd');
      return true;
    });
  });
});

test('the lock wait margin is 10 s, as the README says', () => {
  assert.equal(LOCK_WAIT_MARGIN_MS, 10000);
});

test('the lock file is made private, and a lock whose token could not be written is removed', async (t) => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = makeLedger(dir);
    const openSync = fs.openSync;
    const modes = [];
    t.mock.method(fs, 'openSync', (file, flags, mode) => {
      if (file === ledger.lock) modes.push(mode);
      return openSync(file, flags, mode);
    });
    await ledger.reserve(1, 'one');
    assert.deepEqual(modes, [0o600]);
    const writeSync = fs.writeSync;
    t.mock.method(fs, 'writeSync', (descriptor, ...rest) => {
      if (modes.length === 2) {
        const error = new Error('no space left on device');
        error.code = 'ENOSPC';
        throw error;
      }
      return writeSync(descriptor, ...rest);
    });
    await assert.rejects(ledger.reserve(1, 'two'), { code: 'ENOSPC' });
    assert.equal(fs.existsSync(ledger.lock), false, 'no lock left behind');
  });
});

test('a corrupt line is named by number and file only, never by its text', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'ledger.jsonl');
    const line = `${JSON.stringify(makeSettledRow(1))}\n`;
    fs.writeFileSync(file, `${line}not json SECRETTEXT\n${line}`);
    assert.throws(
      () => readLedger(file),
      (error) =>
        error instanceof LedgerError &&
        /corrupt ledger line 2 in .*: not valid JSON$/.test(error.message) &&
        !error.message.includes('SECRETTEXT'),
    );
  });
});

test('a row whose run, label, status, cost_source, kind or model is not text is a corrupt line', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'ledger.jsonl');
    for (const field of [
      'run',
      'label',
      'status',
      'cost_source',
      'kind',
      'model',
    ]) {
      fs.writeFileSync(
        file,
        `${JSON.stringify({ ...makeSettledRow(1), [field]: 7 })}\n`,
      );
      assert.throws(
        () => readLedger(file),
        /corrupt ledger line 1 .*: not a ledger row/,
        field,
      );
    }
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...makeSettledRow(1), model: null })}\n`,
    );
    assert.equal(readLedger(file).total, 1, 'a null model is allowed');
  });
});
