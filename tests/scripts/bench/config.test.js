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
    estimate_usd_per_call: {
      subject: 0.078125,
      judge: 0.0625,
      writer: 0.01375,
    },
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
      }),
    });
    assert.deepEqual(seatsOf(config), ['solo']);
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
