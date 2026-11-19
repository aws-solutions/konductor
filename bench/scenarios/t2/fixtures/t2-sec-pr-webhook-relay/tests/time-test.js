import test from 'node:test';
import assert from 'node:assert/strict';
import { secondsSince } from '../src/util/time.js';

test('time helper measures absolute seconds', () => {
  assert.equal(secondsSince(100, 102000), 2);
});
