'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');

test.beforeEach(() => board.reset());

test('starts with ordered columns and seeded cards', () => {
  const state = board.getState();
  assert.deepEqual(state.columns.map((column) => column.id), ['inbox', 'active', 'done']);
  assert.deepEqual(state.columns[0].cardIds, ['briefing', 'wireframe']);
  assert.equal(board.getCard('invoice').assignee, 'Mara');
});

test('adds, moves, filters, and selects a card', () => {
  const card = board.addCard({ title: 'Plan launch', labels: ['review'] });
  assert.equal(board.getState().columns[0].cardIds.at(-1), card.id);
  assert.equal(board.moveCard(card.id, 'done', 0), true);
  board.setFilter('launch');
  board.selectCard(card.id);
  assert.equal(board.getState().selectedCardId, card.id);
  assert.equal(board.columnView('done').count, 1);
  assert.equal(board.cardBadge(card).text, 'Review');
});

