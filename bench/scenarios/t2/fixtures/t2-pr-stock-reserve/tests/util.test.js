import test from 'node:test';
import assert from 'node:assert/strict';
import { failure, ok, unwrap } from '../src/util/result.js';
import { positiveInteger } from '../src/util/validation.js';

test('result helpers unwrap successes', () => {
  assert.equal(unwrap(ok(3)), 3);
  assert.throws(() => unwrap(failure('bad', 'nope')), /nope/);
  assert.throws(() => positiveInteger(0, 'units'), /positive/);
});
