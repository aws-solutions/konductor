// SPDX-License-Identifier: Apache-2.0
// Shared helpers for the skill-benchmark tests: small valid documents in each file format, `edit` to damage
// one field at a time, file helpers, and the name table every name-rule test reads. Nothing here reads run output.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadConfig,
  EXAMPLE_CONFIG_FILE,
} = require('../../../scripts/bench/lib/config');

const SKILL = 'brew-log';
/** A fake SHA-256 hex string: `digit` repeated 64 times. */
const makeFakeSha256 = (digit) => digit.repeat(64);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
/** Writes `data` as JSON, or as given when it is a string (to write broken JSON on purpose). */
const write = (file, data) =>
  fs.writeFileSync(
    file,
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  );
/** Reads a JSON file, lets `mutate` change it in place, writes it back. */
const update = (file, mutate) => {
  const data = readJson(file);
  mutate(data);
  write(file, data);
};
/** Runs callback(dir) in a throw-away directory that is removed afterwards. */
function withTmp(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
  try {
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Like withTmp, for an async callback: the directory is removed after the returned promise settles. */
async function withTmpAsync(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
  try {
    return await callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/**
 * A copy of `source` with the value at the dotted path `dottedPath` ("rules.0.id") replaced; `undefined`
 * deletes the field. The field is defined as an own property, so a key such as `__proto__` is a real key,
 * the way `JSON.parse` makes it, instead of a prototype assignment.
 */
function edit(source, dottedPath, value) {
  const copy = JSON.parse(JSON.stringify(source));
  const pathKeys = dottedPath.split('.');
  const lastKey = pathKeys.pop();
  const parent = pathKeys.reduce((node, key) => node[key], copy);
  if (value === undefined) delete parent[lastKey];
  else
    Object.defineProperty(parent, lastKey, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return copy;
}

const RULE_CLASSES = [
  'useful',
  'useful',
  'style',
  'generic',
  'useful',
  'style',
];
const BUCKET_OF = { useful: 'value', style: 'format', generic: 'guard' };
const FILLER =
  'The kettle was already warm and the cups were set out on the shelf near the window before anyone arrived. ';
const goodRules = () => ({
  format_version: 1,
  skill: SKILL,
  skill_md_sha256: makeFakeSha256('a'),
  request_context:
    'A request to write a short log entry for a tea or coffee brew.',
  rules: RULE_CLASSES.map((ruleClass, index) => ({
    id: `${SKILL}-r0${index + 1}`,
    source_quote: `Quote number ${index + 1} from the skill text`,
    class: ruleClass,
    outcome: `Outcome ${index + 1}.`,
    why: `Reason ${index + 1}.`,
    scenario_hint: `Situation ${index + 1}.`,
  })),
});
/** Five tasks of 100+ words, each with five checklist items (rules r01 to r05; r06 is dropped). */
const goodTasks = () => ({
  format_version: 1,
  skill: SKILL,
  batch: 'b1',
  generated_at: '2026-01-15T10:00:00Z',
  model: 'human',
  skills_version: 'fixture-1',
  rules_sha256: makeFakeSha256('b'),
  scenarios: [1, 2, 3, 4, 5].map((taskNumber) => ({
    id: `${SKILL}-rules-${taskNumber}`,
    title: `Task ${taskNumber}`,
    target_section: 'Rules',
    prompt: `Request ${taskNumber}. ${FILLER.repeat(7)}Please write the entry.`,
    rubric: [1, 2, 3, 4, 5].map(
      (itemNumber) => `The entry shows outcome number ${itemNumber}.`,
    ),
  })),
});
const goodBuckets = () => {
  const rules = goodRules().rules;
  const buildItem = (rule) => ({
    bucket: BUCKET_OF[rule.class],
    rule_id: rule.id,
  });
  return {
    format_version: 1,
    skill: SKILL,
    batch: 'b1',
    rules: Object.fromEntries(
      rules.map((rule, index) => [
        rule.id,
        { class: rule.class, kept: index < 5, bucket: BUCKET_OF[rule.class] },
      ]),
    ),
    scenarios: Object.fromEntries(
      goodTasks().scenarios.map((scenario) => [
        scenario.id,
        Object.fromEntries(
          rules
            .slice(0, 5)
            .map((rule, index) => [String(index + 1), buildItem(rule)]),
        ),
      ]),
    ),
  };
};
const goodExclusions = () => ({
  format_version: 1,
  batches: {
    b1: {
      scenarios: [
        {
          id: `${SKILL}-rules-3`,
          scales: ['outcome'],
          reason: 'the request-only writer exceeded the item limit twice',
          date: '2026-01-16',
        },
      ],
    },
  },
});
/** The committed fixture: a miniature repository root with one skill that has a baseline. */
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'bench');
/** The fixture repository root. Throws, loudly, when the fixture is gone, so a test never passes on nothing. */
function fixtureRoot() {
  const marker = path.join(FIXTURE_DIR, 'repo', 'skills', SKILL, 'SKILL.md');
  if (!fs.existsSync(marker))
    throw new Error(
      `benchmark fixture is missing: expected ${marker}. Restore tests/fixtures/bench/.`,
    );
  return path.join(FIXTURE_DIR, 'repo');
}
/** Runs callback(dir, layout) on a throw-away copy of the fixture root, so a test can add, change or delete files. */
const withFixtureCopy = (callback) =>
  withTmp((dir) => {
    fs.cpSync(fixtureRoot(), dir, { recursive: true });
    return callback(
      dir,
      require('../../../scripts/bench/lib/layout').createLayout({ root: dir }),
    );
  });

/**
 * The committed example settings with `changes` merged in: objects merge key by key, anything else replaces, and
 * undefined deletes the key. Tests write it as a settings file, which must hold every setting.
 */
function settingsWith(changes = {}, base = readExample()) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete merged[key];
    else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      merged[key] !== null &&
      typeof merged[key] === 'object' &&
      !Array.isArray(merged[key])
    )
      merged[key] = settingsWith(value, merged[key]);
    else merged[key] = value;
  }
  return merged;
}
const readExample = () =>
  JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_FILE, 'utf8'));

/**
 * Names for the name-rule tests: [name, usable as a path segment (SAFE_SEGMENT), usable as a batch name
 * (BATCH_NAME)]. One table feeds the pattern tests, the layout tests and the validator tests, so a case is
 * written once. Every batch name is also a path segment.
 */
const NAME_CASES = [
  ['brew-log-rules-1', true, true],
  ['rules-b5', true, true],
  ['b1', true, true],
  ['a', true, true],
  ['7', true, true],
  ['0', true, true],
  ['x'.repeat(128), true, true],
  ['Task_1.v2', true, false],
  ['a.b', true, false],
  ['b.c', true, false],
  ['c', true, true],
  ['B1', true, false],
  ['b_1', true, false],
  ['b.1', true, false],
  ['x'.repeat(129), false, false],
  ['', false, false],
  [' ', false, false],
  ['two words', false, false],
  ['tab\there', false, false],
  ['line\nbreak', false, false],
  ['x\n', false, false],
  ['b1\n', false, false],
  ['nul\0', false, false],
  ['-x', false, false],
  ['_x', false, false],
  ['.x', false, false],
  ['.hidden', false, false],
  ['.b1', false, false],
  ['..', false, false],
  ['a..b', false, false],
  ['x..y', false, false],
  ['a/b', false, false],
  ['a\\b', false, false],
  ['/abs', false, false],
  ['../evil', false, false],
];
/** Names that are not a path segment. */
const UNSAFE_NAMES = NAME_CASES.filter(([, isSegment]) => !isSegment).map(
  ([name]) => name,
);
/** Values that are not even strings. */
const NON_STRING_NAMES = [null, 7, {}, ['a']];
/** Writes ledger rows (objects) as JSON lines, creating the folder. */
function writeLedger(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
  );
}

/**
 * The settings of the committed bench/config.example.json, with `overrides` merged as the command line would.
 * Tests use it where they need the default settings.
 */
function exampleConfig(overrides) {
  return loadConfig({ file: EXAMPLE_CONFIG_FILE, overrides });
}

module.exports = {
  SKILL,
  makeFakeSha256,
  readJson,
  write,
  update,
  withTmp,
  withTmpAsync,
  edit,
  exampleConfig,
  writeLedger,
  goodRules,
  goodTasks,
  goodBuckets,
  goodExclusions,
  FIXTURE_DIR,
  fixtureRoot,
  withFixtureCopy,
  settingsWith,
  NAME_CASES,
  UNSAFE_NAMES,
  NON_STRING_NAMES,
};
