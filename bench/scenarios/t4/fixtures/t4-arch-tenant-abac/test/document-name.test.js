"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDocumentName } = require('../src/document-name');

test('supported document names pass', () => { assert.equal(validateDocumentName('brief.pdf', 100), true); });
test('path traversal and unknown extensions fail', () => {
  assert.equal(validateDocumentName('../brief.pdf'), false);
  assert.equal(validateDocumentName('brief.exe'), false);
});
