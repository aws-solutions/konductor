import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSections, sectionLabel } from '../src/account-settings.js';

test('account sections keep their public labels', () => {
  assert.deepEqual(accountSections.map((section) => section.slug), ['profile', 'security', 'notifications']);
  assert.equal(sectionLabel('security'), 'Security');
});

test('unknown account section gets a general label', () => {
  assert.equal(sectionLabel('other'), 'Account');
});
