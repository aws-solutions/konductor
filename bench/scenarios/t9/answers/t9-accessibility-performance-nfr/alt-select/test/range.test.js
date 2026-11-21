import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRange } from '../src/range.js';

test('empty boxes are fine', () => {
  assert.deepEqual(validateRange('', ''), { from: '', to: '' });
  assert.deepEqual(validateRange('2025-03-01', ''), { from: '', to: '' });
});

test('To before From is reported on To', () => {
  const r = validateRange('2025-03-10', '2025-03-01');
  assert.equal(r.from, '');
  assert.match(r.to, /earlier/);
});

test('same day is allowed', () => {
  assert.deepEqual(validateRange('2025-03-10', '10/03/2025'), { from: '', to: '' });
});

test('a day that does not exist is reported on its own field', () => {
  assert.notEqual(validateRange('2025-02-30', '').from, '');
  assert.notEqual(validateRange('', '31/04/2025').to, '');
});

test('leap day is real in 2024 only', () => {
  assert.equal(validateRange('2024-02-29', '').from, '');
  assert.notEqual(validateRange('2025-02-29', '').from, '');
});
