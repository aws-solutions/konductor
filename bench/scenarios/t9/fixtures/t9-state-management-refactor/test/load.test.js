'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');

test.afterEach(() => board.reset());

test('loads a small saved record and exposes its column view', () => {
  board.load({
    version: 1,
    columns: [
      { id: 'inbox', title: 'Inbox', cardIds: ['one'] },
      { id: 'done', title: 'Done', cardIds: [] }
    ],
    cards: {
      one: { id: 'one', title: 'A small imported task', description: '', assignee: '', labels: [] }
    }
  });
  assert.equal(board.columnView('inbox').cards[0].title, 'A small imported task');
  assert.equal(board.columnView('done').count, 0);
});
