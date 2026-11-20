import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId } from '../src/util/ids.ts';
import { ok, fail } from '../src/util/result.ts';
import { reconcileNames } from '../src/ops/reconcile.ts';

test('ids have a prefix', () => assert.match(makeId(), /^job-/));
test('ok wraps a value', () => assert.deepEqual(ok(3), { ok: true, value: 3 }));
test('fail wraps an error', () => assert.equal(fail(new Error('x')).ok, false));
test('reconcile trims duplicates', () => assert.deepEqual(reconcileNames([' a ', 'a', 'b']), ['a', 'b']));
