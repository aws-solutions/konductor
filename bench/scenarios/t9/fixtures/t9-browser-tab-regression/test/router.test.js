import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionHash } from '../src/router.js';

test('parseSectionHash accepts a simple section hash', () => {
  assert.equal(parseSectionHash('#billing'), 'billing');
  assert.equal(parseSectionHash('  #getting-started  '), 'getting-started');
});

test('parseSectionHash decodes safe names and checks known sections', () => {
  assert.equal(parseSectionHash('#GETTING-STARTED', ['getting-started']), 'getting-started');
  assert.equal(parseSectionHash('#unknown', ['billing', 'security']), null);
  assert.equal(parseSectionHash('billing', ['billing']), null);
});

test('parseSectionHash rejects malformed values', () => {
  assert.equal(parseSectionHash(''), null);
  assert.equal(parseSectionHash('#two words'), null);
  assert.equal(parseSectionHash('#bad%2Fpath'), null);
  assert.equal(parseSectionHash(null), null);
});
