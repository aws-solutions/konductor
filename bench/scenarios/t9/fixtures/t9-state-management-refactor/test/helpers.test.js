'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../src/format');
const palette = require('../src/palette');
const ids = require('../src/ids');

test('formats labels and counts for compact views', () => {
  assert.equal(format.titleCase('  mIXED words '), 'Mixed Words');
  assert.equal(format.compactCount(1), '1 card');
  assert.equal(format.compactCount(4), '4 cards');
  assert.equal(format.initials('Mara Chen'), 'MC');
});

test('provides a fallback palette and predictable draft ids', () => {
  assert.equal(palette.colorForTone('coral'), '#d86d5c');
  assert.equal(palette.colorForTone('unknown'), '#9b9b9b');
  ids.resetIds();
  assert.equal(ids.makeDraftId(), 'card-41');
  assert.equal(ids.makeDraftId('note'), 'note-42');
});
