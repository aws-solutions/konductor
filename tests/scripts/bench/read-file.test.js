// SPDX-License-Identifier: Apache-2.0
// Tests for reading files (scripts/bench/lib/read-file.js): the one JSON parser every JSON file the bench reads goes
// through. It drops a leading byte order mark and refuses a key that appears twice in one object.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  readFile,
  parseJson,
  readJsonFile,
  JsonFileError,
} = require('../../../scripts/bench/lib/read-file');
const helpers = require('./helpers');

const BOM = '\uFEFF';
const FILE = 'bench/exclusions.json';

/** The message `parseJson` gives for `text`, or null when it parses. */
const messageFor = (text) => {
  try {
    parseJson(text, FILE);
    return null;
  } catch (error) {
    assert.ok(error instanceof JsonFileError, String(error));
    return error.message;
  }
};

test('parseJson reads what JSON.parse reads', () => {
  for (const text of [
    '{"a": 1, "b": [true, null, "x"], "c": {"d": -1.5e3}}',
    '[]',
    '{}',
    '"text"',
    '7',
    '{"a": {"x": 1}, "b": {"x": 2}}',
    '[{"x": 1}, {"x": 2}]',
    '{"a": "{\\"b\\": 1, \\"b\\": 2}"}',
    '{"a,b": 1, "a": 2}',
    '{"": 1, " ": 2}',
  ])
    assert.deepEqual(parseJson(text, FILE), JSON.parse(text), text);
});

test('a leading byte order mark is dropped, and only a leading one', () => {
  assert.deepEqual(parseJson(`${BOM}{"a": 1}`, FILE), { a: 1 });
  assert.deepEqual(parseJson(`${BOM}[1]`, FILE), [1]);
  assert.match(messageFor(`{"a": 1}${BOM}`), /cannot be read as JSON/);
  assert.match(messageFor(`${BOM}${BOM}{"a": 1}`), /cannot be read as JSON/);
});

test('bad JSON is a JsonFileError that names the file and says it cannot be read as JSON', () => {
  for (const text of ['{ not json', '', '{"a": 1,}', `${BOM}`])
    assert.match(
      messageFor(text),
      /^bench\/exclusions\.json: cannot be read as JSON \(.+\)$/,
      JSON.stringify(text),
    );
});

// [name, text, where it is, line of the second use]
const DUPLICATES = [
  [
    'at the top level',
    '{"b1": 1,\n "b1": 2}',
    '"b1" twice at the top level',
    2,
  ],
  [
    'in a nested object',
    '{"batches": {"b1": 1, "b1": 2}}',
    '"b1" twice in batches',
    1,
  ],
  [
    'two levels down',
    '{"a": {"b": {"c": 1,\n\n"c": 2}}}',
    '"c" twice in a.b',
    3,
  ],
  [
    'in an object inside an array',
    '{"rules": [{"id": 1}, {"id": 2, "id": 3}]}',
    '"id" twice in rules[1]',
    1,
  ],
  [
    'after a nested value',
    '{"a": {"x": 1}, "b": 2, "a": 3}',
    '"a" twice at the top level',
    1,
  ],
  [
    'when one is spelled with an escape',
    '{"a": 1, "\\u0061": 2}',
    '"a" twice at the top level',
    1,
  ],
  [
    'even when both values are equal',
    '{"a": 1, "a": 1}',
    '"a" twice at the top level',
    1,
  ],
  [
    'for a key named __proto__',
    '{"__proto__": 1, "__proto__": 2}',
    '"__proto__" twice at the top level',
    1,
  ],
  ['in a one-line file', '{"a":[{"k":1,"k":2}]}', '"k" twice in a[0]', 1],
];
for (const [name, text, where, line] of DUPLICATES) {
  test(`a key used twice is refused ${name}`, () => {
    assert.equal(
      messageFor(text),
      `${FILE}: has the key ${where} (line ${line}); remove one, because JSON readers keep only the last`,
    );
  });
}

test('parseJson and readJsonFile give the same answer for the same bytes', () => {
  helpers.withTmp((dir) => {
    for (const text of [`${BOM}{"a": [1, 2]}`, '{"a": [1, 2]}']) {
      const file = path.join(dir, 'x.json');
      helpers.write(file, text);
      assert.deepEqual(readJsonFile(file), { a: [1, 2] });
    }
    const dupFile = path.join(dir, 'dup.json');
    helpers.write(dupFile, '{"a": 1, "a": 2}');
    assert.throws(
      () => readJsonFile(dupFile),
      (error) =>
        error instanceof JsonFileError &&
        error.file === dupFile &&
        error.message.startsWith(`${dupFile}: has the key "a" twice`),
    );
  });
});

test('a read failure is the system error, with the file named', () => {
  helpers.withTmp((dir) => {
    assert.throws(
      () => readJsonFile(path.join(dir, 'missing.json')),
      (error) => error.code === 'ENOENT' && !(error instanceof JsonFileError),
    );
    assert.throws(
      () => readJsonFile(dir),
      (error) => error.code === 'EISDIR' && error.path === dir,
    );
    assert.throws(
      () => readFile(dir, 'utf8'),
      (error) => error.path === dir,
    );
  });
});
