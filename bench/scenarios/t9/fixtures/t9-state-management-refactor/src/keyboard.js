'use strict';

const board = require('./board');

function handleKey(key) {
  if (key === 'n') return board.addCard({ title: 'New card' });
  if (key === 'e') {
    const id = board.getState().selectedCardId;
    return id ? board.beginEdit(id) : null;
  }
  if (key === 'Escape') {
    board.cancelEdit();
    return true;
  }
  if (key === 'Backspace') {
    const id = board.getState().selectedCardId;
    return id ? board.removeCard(id) : false;
  }
  if (key === 'z') return board.undo();
  if (key === 'ArrowLeft' || key === 'ArrowRight') return shiftSelection(key === 'ArrowRight' ? 1 : -1);
  return false;
}

function shiftSelection(direction) {
  const current = board.getState();
  const id = current.selectedCardId;
  if (!id) return false;
  const sourceIndex = current.columns.findIndex((column) => column.cardIds.includes(id));
  const destination = current.columns[sourceIndex + direction];
  if (!destination) return false;
  return board.moveCard(id, destination.id, destination.cardIds.length);
}

module.exports = { handleKey };
