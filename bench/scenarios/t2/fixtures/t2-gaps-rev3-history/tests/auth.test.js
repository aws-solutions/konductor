import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole, isStaff } from '../src/auth.js';

test('role helper accepts the requested role', () => {
  assert.deepEqual(requireRole({ role: 'admin' }, 'admin'), { role: 'admin' });
  assert.equal(isStaff({ role: 'support' }), true);
});
