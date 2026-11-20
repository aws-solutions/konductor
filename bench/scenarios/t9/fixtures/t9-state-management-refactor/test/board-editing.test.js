'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/board');

test.beforeEach(() => board.reset());

test('edits a card through a draft and commits the result', () => {
  const draft = board.beginEdit('briefing');
  assert.equal(draft.title, 'Outline Monday briefing');
  board.updateDraft({ title: 'Outline Tuesday briefing', labels: ['urgent'] });
  const saved = board.commitEdit();
  assert.equal(saved.title, 'Outline Tuesday briefing');
  assert.deepEqual(saved.labels, ['urgent']);
  assert.equal(board.getState().draft, null);
});

test('cancel leaves the stored card unchanged', () => {
  board.beginEdit('wireframe');
  board.updateDraft({ title: 'Temporary wording' });
  board.cancelEdit();
  assert.equal(board.getCard('wireframe').title, 'Polish mobile wireframe');
  assert.equal(board.getState().draft, null);
});

test('removing a selected card removes its selection', () => {
  board.selectCard('invoice');
  assert.equal(board.removeCard('invoice'), true);
  assert.equal(board.getState().selectedCardId, null);
  assert.equal(board.removeCard('invoice'), false);
});
