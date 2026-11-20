'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');
const keyboard = require('../src/keyboard');
const drag = require('../src/drag');
const persist = require('../src/persist');

test.beforeEach(() => board.reset());

test('keyboard commands operate on the board', () => {
  board.selectCard('briefing');
  assert.equal(keyboard.handleKey('e').id, 'briefing');
  keyboard.handleKey('Escape');
  assert.equal(board.getState().draft, null);
  assert.equal(keyboard.handleKey('n').title, 'New card');
});

test('drag payloads reject unrelated values', () => {
  const payload = drag.encodeCardDrag('briefing', 'inbox');
  assert.deepEqual(drag.decodeCardDrag(payload), { cardId: 'briefing', columnId: 'inbox' });
  assert.equal(drag.decodeCardDrag('not json'), null);
  assert.equal(drag.dropCard(board, payload, 'done', 0), true);
  assert.equal(board.getState().columns[2].cardIds[0], 'briefing');
});

test('export and import keep the portable board shape', () => {
  const record = persist.exportBoard(board);
  assert.equal(record.version, 1);
  board.removeCard('briefing');
  persist.importBoard(board, record);
  assert.equal(board.getCard('briefing').title, 'Outline Monday briefing');
  assert.equal(board.getState().filter, '');
});
