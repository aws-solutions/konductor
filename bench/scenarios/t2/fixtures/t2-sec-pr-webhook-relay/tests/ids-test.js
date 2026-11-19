import test from 'node:test';
import assert from 'node:assert/strict';
import { nextId } from '../src/util/ids.js';

test('generated ids have a prefix', () => {
  assert.match(nextId(), /^evt_/);
});
