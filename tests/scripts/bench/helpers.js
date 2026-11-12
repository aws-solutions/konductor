// SPDX-License-Identifier: Apache-2.0
// Shared helpers for the skill-benchmark tests: `edit` to damage one field at a time, file helpers, and the
// name table every name-rule test reads. Nothing here reads run output.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadConfig,
  EXAMPLE_CONFIG_FILE,
} = require('../../../scripts/bench/lib/config');

/** Writes `data` as JSON, or as given when it is a string (to write broken JSON on purpose). */
const write = (file, data) =>
  fs.writeFileSync(
    file,
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  );
/** Runs callback(dir) in a throw-away directory that is removed afterwards. */
function withTmp(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
  try {
    return callback(dir);
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

/**
 * The settings of the committed bench/config.example.json, with `overrides` merged as the command line would.
 * Tests use it where they need the default settings.
 */
function exampleConfig(overrides) {
  return loadConfig({ file: EXAMPLE_CONFIG_FILE, overrides });
}

module.exports = {
  write,
  withTmp,
  edit,
  exampleConfig,
  NAME_CASES,
  UNSAFE_NAMES,
  NON_STRING_NAMES,
};
