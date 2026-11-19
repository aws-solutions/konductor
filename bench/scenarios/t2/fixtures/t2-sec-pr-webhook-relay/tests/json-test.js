import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../src/util/json.js';

test('json parser returns values and errors', () => {
  assert.deepEqual(parseJson('{"a":1}').value, { a: 1 });
  assert.ok(parseJson('{').error);
});
