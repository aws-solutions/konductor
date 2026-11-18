// SPDX-License-Identifier: Apache-2.0
// Tests for config loading (scripts/bench/lib/config.js): the committed example holds every setting at its
// default, a settings file must have every setting, and every one of them can be overridden from code.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const {
  ConfigError,
  EXAMPLE_CONFIG_FILE,
  missingConfigMessage,
  loadConfig,
  rubricWriterModel,
  seatsOf,
  judgeConcurrency,
} = require('../../../scripts/bench/lib/config');
const { REPO_ROOT } = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

const EXAMPLE = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_FILE, 'utf8'));
/** Writes a settings file: the example with `changes` (dotted path to value; undefined deletes) applied. */
const writeSettings = (dir, name, changes = {}) => {
  const settings = Object.entries(changes).reduce(
    (edited, [dotted, value]) => helpers.edit(edited, dotted, value),
    EXAMPLE,
  );
  const file = path.join(dir, name);
  helpers.write(file, settings);
  return file;
};

test('the example holds the expected default settings', () => {
  const judges = {
    anthropic: 'us.anthropic.claude-opus-5-5',
    openai: 'us.openai.gpt-6.1-terra',
    xai: 'us.xai.grok-4.7',
  };
  assert.deepEqual(helpers.exampleConfig(), {
    models: { subject: 'claude-sonnet-5-5', judges, rubric_writer: null },
    max_usd: 30,
    total_cap_usd: 100,
    confirm_above_usd: 5,
    aws_profile: null,
    aws_region: 'us-west-2',
    judge_timeout_ms: 240000,
    judge_timeout_ms_by_seat: { xai: 720000 },
    judge_max_output_tokens: 9000,
    judge_max_output_tokens_by_seat: { openai: 5000, xai: 37500 },
    judge_concurrency: 3,
    judge_concurrency_by_seat: { xai: 12 },
    estimate_usd_per_call: {
      subject: 0.078125,
      judge: 0.0625,
      writer: 0.01375,
    },
    runner_profile: 'legacy',
    subject_concurrency: 6,
  });
});

// The planning figures, per batch of 8 tasks with 3 judge seats: paired runs 1.25 (16 runs), judging 3.00 for each of the two
// readings (48 calls each: each seat judges each of the 2 answers on its own) and checklist writing 0.11 (8 calls). Lower
// prices (0.0735 per run, 0.0571 per judge call, 0.0138 per checklist call) give 13.54 for a skill, below 14.72, which is
// the unsafe side for a guard that refuses plans above max_usd.
test('the fallback unit prices (no cost history) project 14.72 USD for a skill of two batches of 8 tasks', () => {
  const prices = helpers.exampleConfig().estimate_usd_per_call;
  const assertAtLeast = (actual, floor, description) =>
    assert.ok(
      actual >= floor - 1e-9,
      `${description}: ${actual} is below the planning figure ${floor}`,
    );
  assertAtLeast(16 * prices.subject, 1.25, 'paired runs of a batch');
  assertAtLeast(48 * prices.judge, 3, 'judging one reading of a batch');
  assertAtLeast(8 * prices.writer, 0.11, 'checklist writing of a batch');
  const skill =
    2 * (16 * prices.subject + 96 * prices.judge + 8 * prices.writer);
  assertAtLeast(skill, 14.72, 'a skill');
  assert.ok(skill < 15, `a skill is quoted as about 15 USD, got ${skill}`);
  assert.ok(
    2 * (16 * 0.0735 + 96 * 0.0571 + 8 * 0.0138) < 14.72,
    'the lower prices are the figure this test guards against',
  );
});

// Every setting in the example, overridden one at a time: the result is the example with only that setting changed.
const isMap = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const listSettings = (object, parentPath = '') =>
  Object.entries(object).flatMap(([key, value]) => {
    const name = parentPath ? `${parentPath}.${key}` : key;
    // The runner profile is one of a fixed set of names, so the other shipped profile is the changed value.
    if (name === 'runner_profile') return [[name, 'natural']];
    if (!isMap(value))
      return [
        [
          name,
          typeof value === 'number'
            ? value + 1
            : Array.isArray(value)
              ? ['changed']
              : 'changed',
        ],
      ];
    return Object.keys(value).length
      ? listSettings(value, name)
      : [[`${name}.some-key`, 'changed']]; // an open map: add an entry
  });
const nestUnderPath = (dotted, value) =>
  dotted.split('.').reduceRight((inner, key) => ({ [key]: inner }), value);
for (const [setting, value] of [
  ...listSettings(EXAMPLE),
  ['models.judges.extra', 'changed'],
  ['max_usd', 100],
]) {
  test(`override: ${setting} = ${JSON.stringify(value)} changes nothing else`, () => {
    assert.deepEqual(
      helpers.exampleConfig(nestUnderPath(setting, value)),
      helpers.edit(EXAMPLE, setting, value),
    );
  });
}

test('the checklist writer defaults to the anthropic seat; a null seat is removed', () => {
  assert.equal(
    rubricWriterModel(helpers.exampleConfig()),
    'us.anthropic.claude-opus-5-5',
  );
  assert.equal(
    rubricWriterModel(
      helpers.exampleConfig({ models: { rubric_writer: 'writer-x' } }),
    ),
    'writer-x',
  );
  assert.deepEqual(seatsOf(helpers.exampleConfig()), [
    'anthropic',
    'openai',
    'xai',
  ]);
  const noSeat = helpers.exampleConfig({
    models: {
      rubric_writer: 'writer-y',
      judges: { anthropic: null, solo: 'm' },
    },
  });
  assert.deepEqual(seatsOf(noSeat), ['openai', 'xai', 'solo']);
  assert.equal(rubricWriterModel(noSeat), 'writer-y');
  // With no `anthropic` seat and no rubric_writer there is no checklist writer: loadConfig refuses it and names the
  // field, and rubricWriterModel still guards a settings object that was built by hand.
  assert.throws(
    () =>
      helpers.exampleConfig({
        models: { judges: { anthropic: null, solo: 'm' } },
      }),
    (error) =>
      error instanceof ConfigError &&
      /models\.rubric_writer: set it, or keep an "anthropic" judge seat/.test(
        error.message,
      ),
  );
  assert.throws(
    () =>
      rubricWriterModel({
        models: { rubric_writer: null, judges: { solo: 'm' } },
      }),
    (error) =>
      error instanceof ConfigError && /no checklist writer/.test(error.message),
  );
});

test('the loaded settings are frozen and the example file is never changed by a load', () => {
  const exampleBefore = fs.readFileSync(EXAMPLE_CONFIG_FILE, 'utf8');
  const config = helpers.exampleConfig({
    max_usd: 5,
    models: { judges: { xai: 'other' } },
  });
  assert.equal(fs.readFileSync(EXAMPLE_CONFIG_FILE, 'utf8'), exampleBefore);
  assert.equal(helpers.exampleConfig().max_usd, 30);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.models.judges));
  assert.throws(() => (config.max_usd = 1), TypeError);
});

test('with no settings file the load is refused with its full path and the cp command', () => {
  const packageDefault = path.join(REPO_ROOT, 'bench', 'config.json');
  assert.equal(
    missingConfigMessage(packageDefault),
    `${packageDefault} not found: run cp '${EXAMPLE_CONFIG_FILE}' '${packageDefault}', then edit it`,
  );
  helpers.withTmp((dir) => {
    const absent = path.join(dir, 'bench', 'config.json');
    for (const [options, looked] of [
      [undefined, packageDefault],
      [{}, packageDefault],
      [{ overrides: { max_usd: 3 } }, packageDefault],
      [{ defaultFile: absent }, absent],
      [{ defaultFile: absent, overrides: { max_usd: 3 } }, absent],
      // A relative path is named as the absolute path it resolves to, so `--root` cannot make it read as here.
      [{ defaultFile: path.relative(process.cwd(), absent) }, absent],
    ])
      assert.throws(
        () => loadConfig(options),
        (error) =>
          error.message ===
          `${looked} not found: run cp '${EXAMPLE_CONFIG_FILE}' '${looked}', then edit it`,
        JSON.stringify(options),
      );
  });
});

// The command is meant for a POSIX shell; where none is installed there is nothing to run it with.
const posixShell = spawnSync('sh', ['-c', 'exit 0']).status === 0;

test(
  'the printed cp command runs as is when a path holds a space or a single quote',
  { skip: posixShell ? false : 'no POSIX sh on this machine' },
  () => {
    for (const folder of ['with space', "it's"])
      helpers.withTmp((dir) => {
        const root = path.join(dir, folder);
        const example = path.join(root, 'bench', 'config.example.json');
        const target = path.join(root, 'bench', 'config.json');
        fs.mkdirSync(path.dirname(example), { recursive: true });
        fs.writeFileSync(example, '{"max_usd": 25}\n');
        const message = missingConfigMessage(target, example);
        const command = message.match(
          / not found: run (cp .*), then edit it$/,
        )[1];
        execFileSync('sh', ['-c', command], { cwd: dir });
        assert.equal(
          fs.readFileSync(target, 'utf8'),
          '{"max_usd": 25}\n',
          folder,
        );
        assert.equal(fs.readdirSync(dir).length, 1, `${folder}: no stray file`);
      });
  },
);

test('the settings file is read, code overrides it, and an explicit file beats the default file', () => {
  helpers.withTmp((dir) => {
    const file = writeSettings(dir, 'config.json', {
      max_usd: 10,
      total_cap_usd: 60,
      'models.subject': 'from-file',
    });
    const fromFile = loadConfig({ file });
    assert.deepEqual(
      [
        fromFile.max_usd,
        fromFile.total_cap_usd,
        fromFile.models.subject,
        fromFile.confirm_above_usd,
      ],
      [10, 60, 'from-file', 5],
    );
    assert.equal(loadConfig({ file, overrides: { max_usd: 3 } }).max_usd, 3);
    assert.equal(loadConfig({ defaultFile: file }).max_usd, 10);
    assert.equal(
      loadConfig({
        defaultFile: file,
        file: writeSettings(dir, 'other.json', { max_usd: 8 }),
      }).max_usd,
      8,
    );

    assert.throws(
      () => loadConfig({ file: path.join(dir, 'nope.json') }),
      (error) =>
        error instanceof ConfigError &&
        /nope\.json: cannot read the config file \(ENOENT\)/.test(
          error.message,
        ),
    );
    // A default file that is not there gets the cp line from the read itself, so a file that goes away between
    // a check and the read cannot give a different message.
    assert.throws(
      () => loadConfig({ defaultFile: path.join(dir, 'gone.json') }),
      (error) =>
        error instanceof ConfigError &&
        error.message ===
          missingConfigMessage(path.resolve(path.join(dir, 'gone.json'))),
    );
    // A folder where the file should be is a read failure, not a missing file.
    assert.throws(
      () => loadConfig({ defaultFile: dir }),
      (error) =>
        error instanceof ConfigError &&
        /cannot read the config file \(EISDIR\)/.test(error.message),
    );
    const badFile = path.join(dir, 'bad.json');
    helpers.write(badFile, '{ nope');
    assert.throws(
      () => loadConfig({ file: badFile }),
      (error) =>
        error instanceof ConfigError &&
        /bad\.json: cannot be read as JSON/.test(error.message),
    );
    const arrayFile = path.join(dir, 'arr.json');
    helpers.write(arrayFile, '[]');
    assert.throws(
      () => loadConfig({ file: arrayFile }),
      /config: must be an object/,
    );
    const protoFile = path.join(dir, 'proto.json');
    helpers.write(
      protoFile,
      JSON.stringify(EXAMPLE).replace(
        '"judges":{',
        '"judges":{"__proto__":{"polluted":"yes"},',
      ),
    );
    assert.throws(
      () => loadConfig({ file: protoFile }),
      /models\.judges\.__proto__: not a valid setting name/,
    );
    assert.equal({}.polluted, undefined);
  });
});

test('a settings file with a missing, a missing nested or an unknown setting is refused by name', () => {
  helpers.withTmp((dir) => {
    const refuses = (changes, expected) =>
      assert.throws(
        () => loadConfig({ file: writeSettings(dir, 'c.json', changes) }),
        expected,
      );
    refuses(
      { max_usd: undefined },
      /max_usd: missing; copy it from bench\/config\.example\.json/,
    );
    refuses(
      { 'models.subject': undefined },
      /models\.subject: missing; copy it from bench\/config\.example\.json/,
    );
    refuses(
      { 'estimate_usd_per_call.writer': undefined },
      /estimate_usd_per_call\.writer: missing/,
    );
    refuses({ max_usdd: 5 }, /max_usdd: unknown setting/);
    refuses({ 'models.subjct': 'x' }, /models\.subjct: unknown setting/);
    refuses({ models: 'x' }, /models: must be an object/);
    refuses({ 'models.judges': null }, /models\.judges: must be an object/);
    refuses(
      { judge_timeout_ms_by_seat: null },
      /judge_timeout_ms_by_seat: must be an object/,
    );
    refuses(
      { agent_for: {} },
      /agent_for: removed: the agent comes from the agent specs/,
    );
    refuses({ needs_tools: [] }, /needs_tools: removed: not in the MVP/);
    refuses({ stop_usd: 1 }, /stop_usd: replaced by total_cap_usd/);
    refuses(
      { orders_per_pair: 1 },
      /orders_per_pair: removed: each answer is scored on its own/,
    );
    // A missing and an unknown setting are reported together.
    refuses(
      { aws_region: undefined, nope: 1 },
      /nope: unknown setting[\s\S]*aws_region: missing/,
    );
  });
});

test('an open map in the settings file may hold any key, and must not be missing', () => {
  helpers.withTmp((dir) => {
    const config = loadConfig({
      file: writeSettings(dir, 'c.json', {
        'models.judges': { solo: 'm' },
        'models.rubric_writer': 'writer-m',
        judge_timeout_ms_by_seat: { solo: 300000 },
        judge_max_output_tokens_by_seat: { solo: 4000 },
        judge_concurrency_by_seat: {},
      }),
    });
    assert.deepEqual(seatsOf(config), ['solo']);
    assert.deepEqual(config.judge_timeout_ms_by_seat, { solo: 300000 });
    assert.deepEqual(config.judge_max_output_tokens_by_seat, { solo: 4000 });
    assert.throws(
      () =>
        loadConfig({
          file: writeSettings(dir, 'd.json', { 'models.judges': undefined }),
        }),
      /models\.judges: missing/,
    );
  });
});

// bench/config.json is git-ignored; the committed example is the file a person copies to start one.
test('bench/config.example.json loads cleanly and is this package file', () => {
  assert.equal(
    EXAMPLE_CONFIG_FILE,
    path.join(__dirname, '..', '..', '..', 'bench', 'config.example.json'),
  );
  assert.deepEqual(loadConfig({ file: EXAMPLE_CONFIG_FILE }), EXAMPLE);
  assert.equal(loadConfig({ file: EXAMPLE_CONFIG_FILE }).max_usd, 30);
  assert.deepEqual(Object.keys(EXAMPLE).slice(0, 4), [
    'models',
    'max_usd',
    'total_cap_usd',
    'confirm_above_usd',
  ]);
});

test('the known settings come from this package example, not from the folder of the settings file', () => {
  helpers.withTmp((dir) => {
    // A settings file in another checkout, next to an example of its own that has an extra setting.
    fs.mkdirSync(path.join(dir, 'bench'));
    helpers.write(path.join(dir, 'bench', 'config.example.json'), {
      ...EXAMPLE,
      extra: 1,
    });
    const file = path.join(dir, 'bench', 'config.json');
    helpers.write(file, { ...EXAMPLE, extra: 1 });
    assert.throws(() => loadConfig({ file }), /extra: unknown setting/);
  });
});

test('a seat of 64 lowercase characters is accepted, and two seats that differ only in case are not both accepted', () => {
  const longSeat = 'y'.repeat(64);
  assert.deepEqual(
    seatsOf(helpers.exampleConfig({ models: { judges: { [longSeat]: 'm' } } })),
    ['anthropic', 'openai', 'xai', longSeat],
  );
  assert.throws(
    () =>
      helpers.exampleConfig({ models: { judges: { solo: 'm', Solo: 'n' } } }),
    /models\.judges\.Solo: not a valid seat name/,
  );
});

test('a config file may start with a byte order mark, and may not use a key twice', () => {
  helpers.withTmp((dir) => {
    const bomFile = path.join(dir, 'bom.json');
    helpers.write(
      bomFile,
      `\uFEFF${JSON.stringify(helpers.edit(EXAMPLE, 'max_usd', 7))}`,
    );
    assert.equal(loadConfig({ file: bomFile }).max_usd, 7);
    const duplicateFile = path.join(dir, 'dup.json');
    helpers.write(
      duplicateFile,
      '{\n "max_usd": 7,\n "models": { "subject": "a", "subject": "b" }\n}',
    );
    assert.throws(
      () => loadConfig({ file: duplicateFile }),
      /dup\.json: has the key "subject" twice in models \(line 3\); remove one/,
    );
  });
});

test('a removed limit inside a nested setting is an unknown setting, not a replaced one', () => {
  assert.throws(
    () => helpers.exampleConfig({ models: { stop_usd: 1 } }),
    /models\.stop_usd: unknown setting/,
  );
});

test('confirm_above_usd of 0 is accepted and means every paid run asks', () => {
  assert.equal(
    helpers.exampleConfig({ confirm_above_usd: 0 }).confirm_above_usd,
    0,
  );
});

const REFUSED = [
  [{ max_usdd: 5 }, /max_usdd: unknown setting/],
  [{ models: { subjct: 'x' } }, /models\.subjct: unknown setting/],
  [
    { estimate_usd_per_call: { reader: 1 } },
    /estimate_usd_per_call\.reader: unknown setting/,
  ],
  [{ nope: 1, other: 2 }, /nope: unknown[\s\S]*other: unknown/],
  [{ max_usd: 0 }, /max_usd: must be a number above 0/],
  [{ max_usd: '25' }, /max_usd: must be a number above 0/],
  [{ total_cap_usd: -1 }, /total_cap_usd: must be a number above 0/],
  [{ models: { subject: '' } }, /models\.subject: must be a non-empty string/],
  [
    { models: { judges: { xai: 5 } } },
    /models\.judges\.xai: must be a non-empty string/,
  ],
  [
    { models: { judges: { anthropic: null, openai: null, xai: null } } },
    /needs at least one judge seat/,
  ],
  [{ models: { judges: null } }, /models\.judges: must be an object/],
  [
    { models: { judges: { 'a.b': 'm' } } },
    /models\.judges\.a\.b: not a valid seat name/,
  ],
  [
    { models: { judges: { 'a/b': 'm' } } },
    /models\.judges\.a\/b: not a valid seat name/,
  ],
  [
    { models: { judges: { Anthropic: 'm' } } },
    /models\.judges\.Anthropic: not a valid seat name; use lowercase letters/,
  ],
  [
    { models: { judges: { ['y'.repeat(65)]: 'm' } } },
    /models\.judges\.y{65}: not a valid seat name[^]*at most 64 characters/,
  ],
  [
    { models: { rubric_writer: 7 } },
    /models\.rubric_writer: must be a non-empty string/,
  ],
  [{ aws_region: '' }, /aws_region: must be a non-empty string/],
  [
    { estimate_usd_per_call: { subject: -1 } },
    /estimate_usd_per_call\.subject: must be a number, 0 or more/,
  ],
  // Settings the MVP does not have are refused by name, so a stale settings file cannot pass.
  [
    { agent_for: { s: 'k-dev' } },
    /agent_for: removed: the agent comes from the agent specs/,
  ],
  [{ needs_tools: ['s'] }, /needs_tools: removed: not in the MVP/],
  [{ max_usd: 101 }, /need max_usd <= total_cap_usd, got 101, 100/],
  [{ total_cap_usd: 20 }, /need max_usd <= total_cap_usd, got 30, 20/],
  // The two limits that total_cap_usd replaced are refused by name, so a stale config file cannot pass.
  [{ stop_usd: 100 }, /stop_usd: replaced by total_cap_usd/],
  [{ hard_cap_usd: 150 }, /hard_cap_usd: replaced by total_cap_usd/],
  [
    { runner_profile: 'natural-tools' },
    /runner_profile: must be one of legacy, natural, got "natural-tools"/,
  ],
  [{ runner_profile: null }, /runner_profile: must be one of legacy, natural/],
  [
    { subject_concurrency: 0 },
    /subject_concurrency: must be a whole number from 1 to 32/,
  ],
  [
    { subject_concurrency: 33 },
    /subject_concurrency: must be a whole number from 1 to 32/,
  ],
  [{ subject_concurrency: 2.5 }, /subject_concurrency: must be a whole number/],
  [{ subject_concurrency: '4' }, /subject_concurrency: must be a whole number/],
  [
    { stop_usd: 100, hard_cap_usd: 150 },
    /stop_usd: replaced by total_cap_usd[\s\S]*hard_cap_usd: replaced by total_cap_usd/,
  ],
  // Each answer is judged on its own, so the old presentation-order setting is refused by name.
  [
    { orders_per_pair: 1 },
    /orders_per_pair: removed: each answer is scored on its own/,
  ],
  [
    { orders_per_pair: 2 },
    /orders_per_pair: removed: each answer is scored on its own/,
  ],
  // There is no price table: a stale settings file that still has one is told why.
  [
    { model_prices: {} },
    /model_prices: removed: calls are charged at the cost the CLI reports/,
  ],
  [{ confirm_above_usd: -1 }, /confirm_above_usd: must be a number, 0 or more/],
  [
    { confirm_above_usd: Number.NaN },
    /confirm_above_usd: must be a number, 0 or more/,
  ],
  [
    { confirm_above_usd: '5' },
    /confirm_above_usd: must be a number, 0 or more/,
  ],
];
for (const [overrides, expected] of REFUSED) {
  test(`refuses ${JSON.stringify(overrides)}`, () =>
    assert.throws(() => helpers.exampleConfig(overrides), expected));
}

test('judge timeouts: a seat entry is added, replaced or removed with null; the default applies to the rest', () => {
  const config = helpers.exampleConfig({
    judge_timeout_ms: 300000,
    judge_timeout_ms_by_seat: { xai: null, openai: 600000 },
  });
  assert.equal(config.judge_timeout_ms, 300000);
  assert.deepEqual(config.judge_timeout_ms_by_seat, { openai: 600000 });
});

// A seat removed from models.judges needs its per-seat timeout entry removed in the same settings.
test('judge timeouts: an entry for a seat that is not in models.judges is refused, so a removed seat needs its entry removed', () => {
  assert.throws(
    () =>
      helpers.exampleConfig({
        models: { judges: { xai: null } },
        judge_max_output_tokens_by_seat: { xai: null },
      }),
    /judge_timeout_ms_by_seat\.xai: no such judge seat in models\.judges \(remove the entry\)/,
  );
  const noXai = helpers.exampleConfig({
    models: { judges: { xai: null } },
    judge_timeout_ms_by_seat: { xai: null },
    judge_max_output_tokens_by_seat: { xai: null },
    judge_concurrency_by_seat: { xai: null },
  });
  assert.deepEqual(noXai.judge_timeout_ms_by_seat, {});
  assert.throws(
    () => helpers.exampleConfig({ judge_timeout_ms_by_seat: { xia: 720000 } }),
    /judge_timeout_ms_by_seat\.xia: no such judge seat in models\.judges/,
  );
});

for (const [name, overrides, expected] of [
  [
    'zero',
    { judge_timeout_ms: 0 },
    /^ {2}- judge_timeout_ms: must be a whole/m,
  ],
  [
    'a fraction',
    { judge_timeout_ms: 1500.5 },
    /judge_timeout_ms: must be a whole/,
  ],
  ['text', { judge_timeout_ms: '240000' }, /judge_timeout_ms: must be a whole/],
  [
    'under a second',
    { judge_timeout_ms: 999 },
    /judge_timeout_ms: must be a whole/,
  ],
  [
    'over an hour',
    { judge_timeout_ms: 3600001 },
    /judge_timeout_ms: must be a whole/,
  ],
  [
    'a bad seat value',
    { judge_timeout_ms_by_seat: { xai: -1 } },
    /judge_timeout_ms_by_seat\.xai: must be a whole/,
  ],
  [
    'a map that is not an object',
    { judge_timeout_ms_by_seat: 5 },
    /judge_timeout_ms_by_seat: must be an object/,
  ],
]) {
  test(`judge timeouts are validated: ${name}`, () =>
    assert.throws(() => helpers.exampleConfig(overrides), expected));
}

test('judge concurrency: one width per seat, the default for the rest; an entry is added, replaced or removed with null', () => {
  const defaults = helpers.exampleConfig();
  assert.deepEqual(
    seatsOf(defaults).map((seat) => judgeConcurrency(defaults, seat)),
    [3, 3, 12],
  );
  const config = helpers.exampleConfig({
    judge_concurrency: 2,
    judge_concurrency_by_seat: { xai: null, openai: 5 },
  });
  assert.deepEqual(config.judge_concurrency_by_seat, { openai: 5 });
  assert.deepEqual(
    seatsOf(config).map((seat) => judgeConcurrency(config, seat)),
    [2, 5, 2],
  );
});

// A seat removed from models.judges needs its per-seat concurrency entry removed in the same settings.
test('judge concurrency: an entry for a seat that is not in models.judges is refused, so a removed seat needs its entry removed', () => {
  assert.throws(
    () =>
      helpers.exampleConfig({
        models: { judges: { xai: null } },
        judge_timeout_ms_by_seat: { xai: null },
      }),
    /judge_concurrency_by_seat\.xai: no such judge seat in models\.judges \(remove the entry\)/,
  );
  const noXai = helpers.exampleConfig({
    models: { judges: { xai: null } },
    judge_timeout_ms_by_seat: { xai: null },
    judge_max_output_tokens_by_seat: { xai: null },
    judge_concurrency_by_seat: { xai: null },
  });
  assert.deepEqual(noXai.judge_concurrency_by_seat, {});
});

for (const [name, overrides, expected] of [
  [
    'zero',
    { judge_concurrency: 0 },
    /judge_concurrency: must be a whole number from 1 to 32/,
  ],
  [
    'over 32',
    { judge_concurrency: 33 },
    /judge_concurrency: must be a whole number from 1 to 32/,
  ],
  [
    'a fraction',
    { judge_concurrency: 1.5 },
    /judge_concurrency: must be a whole/,
  ],
  ['text', { judge_concurrency: '3' }, /judge_concurrency: must be a whole/],
  [
    'a bad seat value',
    { judge_concurrency_by_seat: { xai: 0 } },
    /judge_concurrency_by_seat\.xai: must be a whole number from 1 to 32/,
  ],
  [
    'a seat that does not exist',
    { judge_concurrency_by_seat: { xia: 4 } },
    /judge_concurrency_by_seat\.xia: no such judge seat in models\.judges/,
  ],
  [
    'a map that is not an object',
    { judge_concurrency_by_seat: [] },
    /judge_concurrency_by_seat: must be an object/,
  ],
]) {
  test(`judge concurrency is validated: ${name}`, () =>
    assert.throws(() => helpers.exampleConfig(overrides), expected));
}

test('judge timeouts: the bounds themselves are allowed', () => {
  for (const timeoutMs of [1000, 3600000])
    assert.equal(
      helpers.exampleConfig({ judge_timeout_ms: timeoutMs }).judge_timeout_ms,
      timeoutMs,
    );
});

for (const [name, overrides, expected] of [
  [
    'below the least',
    { judge_max_output_tokens: 255 },
    /judge_max_output_tokens: must be a whole number of tokens from 256 to 128000/,
  ],
  [
    'zero',
    { judge_max_output_tokens: 0 },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'above the most',
    { judge_max_output_tokens: 128001 },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'a fraction',
    { judge_max_output_tokens: 1500.5 },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'text',
    { judge_max_output_tokens: '9000' },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'an array',
    { judge_max_output_tokens: [9000] },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'null',
    { judge_max_output_tokens: null },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'a map in place of the number (the map is judge_max_output_tokens_by_seat)',
    { judge_max_output_tokens: { anthropic: 9000, openai: 5000, xai: 37500 } },
    /judge_max_output_tokens: must be a whole number of tokens/,
  ],
  [
    'a seat value below the least',
    { judge_max_output_tokens_by_seat: { openai: 255 } },
    /judge_max_output_tokens_by_seat\.openai: must be a whole number of tokens from 256 to 128000/,
  ],
  [
    'a seat value above the most',
    { judge_max_output_tokens_by_seat: { xai: 128001 } },
    /judge_max_output_tokens_by_seat\.xai: must be a whole number of tokens/,
  ],
  [
    'a seat value that is a fraction',
    { judge_max_output_tokens_by_seat: { xai: 1500.5 } },
    /judge_max_output_tokens_by_seat\.xai: must be a whole number of tokens/,
  ],
  [
    'a seat value that is text',
    { judge_max_output_tokens_by_seat: { xai: '37500' } },
    /judge_max_output_tokens_by_seat\.xai: must be a whole number of tokens/,
  ],
  [
    'a seat value that is an array',
    { judge_max_output_tokens_by_seat: { xai: [37500] } },
    /judge_max_output_tokens_by_seat\.xai: must be a whole number of tokens/,
  ],
  [
    'a seat that is not a judge',
    { judge_max_output_tokens_by_seat: { grok: 5000 } },
    /judge_max_output_tokens_by_seat\.grok: no such judge seat in models\.judges \(remove the entry\)/,
  ],
  [
    'a by-seat setting that is not an object',
    { judge_max_output_tokens_by_seat: 5000 },
    /judge_max_output_tokens_by_seat: must be an object/,
  ],
  [
    'a by-seat setting that is an array',
    { judge_max_output_tokens_by_seat: [5000] },
    /judge_max_output_tokens_by_seat: must be an object/,
  ],
]) {
  test(`judge_max_output_tokens is validated: ${name}`, () =>
    assert.throws(() => helpers.exampleConfig(overrides), expected));
}

test('judge_max_output_tokens: the bounds themselves are allowed, for the number and for a seat', () => {
  for (const tokens of [256, 128000, 9000])
    assert.equal(
      helpers.exampleConfig({ judge_max_output_tokens: tokens })
        .judge_max_output_tokens,
      tokens,
    );
  assert.deepEqual(
    helpers.exampleConfig({
      judge_max_output_tokens_by_seat: {
        anthropic: 256,
        openai: 128000,
        xai: 256,
      },
    }).judge_max_output_tokens_by_seat,
    { anthropic: 256, openai: 128000, xai: 256 },
  );
});

test('judge_max_output_tokens_by_seat: a seat entry is added, replaced or removed with null; the number applies to the rest', () => {
  const config = helpers.exampleConfig({
    judge_max_output_tokens: 4000,
    judge_max_output_tokens_by_seat: {
      xai: null,
      openai: 6000,
      anthropic: 12000,
    },
  });
  assert.equal(config.judge_max_output_tokens, 4000);
  assert.deepEqual(config.judge_max_output_tokens_by_seat, {
    openai: 6000,
    anthropic: 12000,
  });
  // The map may be empty: every seat then gets the number.
  assert.deepEqual(
    helpers.exampleConfig({
      judge_max_output_tokens_by_seat: { openai: null, xai: null },
    }).judge_max_output_tokens_by_seat,
    {},
  );
});

// A seat removed from models.judges needs its per-seat output limit removed in the same settings, as for the timeouts.
test('judge_max_output_tokens_by_seat: an entry for a seat that is not in models.judges is refused, so a removed seat needs its entry removed', () =>
  helpers.withTmp((dir) => {
    assert.throws(
      () =>
        helpers.exampleConfig({
          models: { judges: { xai: null } },
          judge_timeout_ms_by_seat: { xai: null },
        }),
      /judge_max_output_tokens_by_seat\.xai: no such judge seat in models\.judges \(remove the entry\)/,
    );
    const file = writeSettings(dir, 'map.json', {
      judge_max_output_tokens_by_seat: { anthropic: 8000, openai: 5000 },
    });
    assert.deepEqual(
      loadConfig({
        file,
        overrides: { judge_max_output_tokens_by_seat: { openai: 7000 } },
      }).judge_max_output_tokens_by_seat,
      { anthropic: 8000, openai: 7000 },
    );
    const dropped = loadConfig({
      file,
      overrides: {
        models: { judges: { openai: null } },
        judge_timeout_ms_by_seat: { xai: null },
        judge_max_output_tokens_by_seat: { openai: null },
        judge_concurrency_by_seat: { xai: null },
      },
    });
    assert.deepEqual(dropped.judge_max_output_tokens_by_seat, {
      anthropic: 8000,
    });
    // A seat added in the same override may have its own limit.
    assert.deepEqual(
      helpers.exampleConfig({
        models: { judges: { solo: 'm' } },
        judge_max_output_tokens_by_seat: { solo: 3000 },
      }).judge_max_output_tokens_by_seat,
      { openai: 5000, xai: 37500, solo: 3000 },
    );
  }));

test('judge_max_output_tokens: a by-seat key named __proto__ is refused, and both settings must be in the file', () =>
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'proto.json');
    helpers.write(
      file,
      JSON.stringify({ ...EXAMPLE }).replace(
        '"judge_max_output_tokens_by_seat":{',
        '"judge_max_output_tokens_by_seat":{"__proto__":5000,',
      ),
    );
    assert.throws(
      () => loadConfig({ file }),
      /judge_max_output_tokens_by_seat\.__proto__: not a valid setting name/,
    );
    assert.throws(
      () =>
        loadConfig({
          file: writeSettings(dir, 'missing.json', {
            judge_max_output_tokens: undefined,
          }),
        }),
      /judge_max_output_tokens: missing; copy it from bench\/config\.example\.json/,
    );
    assert.throws(
      () =>
        loadConfig({
          file: writeSettings(dir, 'missing-seat.json', {
            judge_max_output_tokens_by_seat: undefined,
          }),
        }),
      /judge_max_output_tokens_by_seat: missing; copy it from bench\/config\.example\.json/,
    );
  }));
