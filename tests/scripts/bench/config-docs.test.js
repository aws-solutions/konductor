// SPDX-License-Identifier: Apache-2.0
// The settings documentation and the fixture settings stay in step with the committed bench/config.example.json:
// the README Settings table has one row per setting, and the fixture repository's bench/config.json has the
// example's key structure.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { EXAMPLE_CONFIG_FILE } = require('../../../scripts/bench/lib/config');
const { main } = require('../../../scripts/bench/bench');
const helpers = require('./helpers');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const README = path.join(REPO_ROOT, 'scripts', 'bench', 'README.md');
const EXAMPLE = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_FILE, 'utf8'));
const FIXTURE_SETTINGS = path.join(
  helpers.fixtureRoot(),
  'bench',
  'config.json',
);

/** The names the Settings table must list: every top-level setting, and the keys of `models` as dotted names. */
const documentedNames = (example) =>
  Object.entries(example).flatMap(([key, value]) =>
    key === 'models'
      ? Object.keys(value).map((name) => `models.${name}`)
      : [key],
  );

/** The first cell of every row of the table in the "Settings and cost" section, without its backticks. */
function settingsTableNames(markdown) {
  const section = markdown.split(/^## Settings and cost$/m)[1];
  assert.ok(section, 'the README has a "Settings and cost" section');
  const body = section.split(/^## /m)[0];
  return body
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.split('|')[1].trim().replace(/^`|`$/g, ''));
}

test('the Settings table lists every setting of the example once, and no other', () => {
  const rows = settingsTableNames(fs.readFileSync(README, 'utf8'));
  const names = documentedNames(EXAMPLE);
  assert.equal(new Set(rows).size, rows.length, 'a row is listed twice');
  assert.deepEqual(
    names.filter((name) => !rows.includes(name)),
    [],
    'settings without a row',
  );
  assert.deepEqual(
    rows.filter((name) => !names.includes(name)),
    [],
    'rows that name no setting',
  );
});

test('the check fails on a missing row and on a row that names no setting', () => {
  const markdown = fs.readFileSync(README, 'utf8');
  const rows = settingsTableNames(markdown);
  const withoutRow = markdown.replace(/^\| `max_usd` .*\n/m, '');
  assert.ok(!settingsTableNames(withoutRow).includes('max_usd'));
  assert.equal(settingsTableNames(withoutRow).length, rows.length - 1);
  const extra = markdown.replace(
    /^(\| `max_usd` .*\n)/m,
    '$1| `no_such_setting` | 1 | x | y |\n',
  );
  assert.ok(settingsTableNames(extra).includes('no_such_setting'));
});

const keyStructure = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, keyStructure(inner)]),
      )
    : null;

/** The value of a dotted setting name in the example: `max_usd`, `models.subject`. */
const exampleValue = (name) =>
  name.split('.').reduce((value, key) => value[key], EXAMPLE);
/** Every leaf of a value as the text the Default cell must show: a string as is, a number, true, false or null. */
const leafTexts = (value) =>
  value !== null && typeof value === 'object'
    ? Object.values(value).flatMap(leafTexts)
    : [String(value)];
/** The Default cell (second column) of each row of the Settings table, by setting name. */
function settingsTableDefaults(markdown) {
  const body = markdown.split(/^## Settings and cost$/m)[1].split(/^## /m)[0];
  return Object.fromEntries(
    body
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => line.split('|'))
      .map((cells) => [cells[1].trim().replace(/^`|`$/g, ''), cells[2]]),
  );
}
/** The settings whose Default cell does not hold every leaf value of the example, with the missing values. */
const staleDefaults = (markdown) =>
  Object.entries(settingsTableDefaults(markdown))
    .map(([name, cell]) => [
      name,
      leafTexts(exampleValue(name)).filter(
        (text) =>
          !new RegExp(
            `(^|[^\\w.])${text.replace(/\./g, '\\.')}(?![\\w.])`,
          ).test(cell),
      ),
    ])
    .filter(([, missing]) => missing.length);

test('the Settings table shows the example value of every setting as its default', () => {
  assert.deepEqual(staleDefaults(fs.readFileSync(README, 'utf8')), []);
});

test('the default check fails on a stale default', () => {
  const markdown = fs.readFileSync(README, 'utf8');
  const stale = markdown.replace(/^(\| `max_usd` +\| `)30(`)/m, `$125$2`);
  assert.notEqual(stale, markdown, 'the max_usd row was found');
  assert.deepEqual(staleDefaults(stale), [['max_usd', ['30']]]);
});

test('--help shows the example max_usd as the default of --max-usd', () => {
  const io = { out: '', err: '' };
  main(['plan', '--help'], {
    out: (text) => (io.out += text),
    err: (text) => (io.err += text),
  });
  assert.match(
    io.out,
    new RegExp(`--max-usd <n> .*\\(default: ${EXAMPLE.max_usd}\\)`),
  );
});

test('the fixture repository has a committed bench/config.json with the key structure of the example', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_SETTINGS, 'utf8'));
  assert.deepEqual(keyStructure(fixture), keyStructure(EXAMPLE));
  assert.deepEqual(fixture, EXAMPLE, 'it holds the example values');
  // The root .gitignore entry for bench/config.json must not hide the fixture copy. A path that is not ignored
  // makes check-ignore exit 1.
  assert.throws(
    () =>
      execFileSync(
        'git',
        ['check-ignore', '-q', path.relative(REPO_ROOT, FIXTURE_SETTINGS)],
        { cwd: REPO_ROOT, stdio: 'ignore' },
      ),
    (error) => error.status === 1,
  );
  assert.doesNotThrow(() =>
    execFileSync('git', ['check-ignore', '-q', 'bench/config.json'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    }),
  );
});
