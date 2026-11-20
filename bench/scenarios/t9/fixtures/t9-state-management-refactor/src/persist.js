'use strict';

function exportBoard(board) {
  const state = board.getState();
  return {
    version: 1,
    columns: state.columns.map((column) => ({
      id: column.id,
      title: column.title,
      cardIds: [...column.cardIds]
    })),
    cards: Object.fromEntries(Object.entries(state.cards).map(([id, card]) => [id, {
      id,
      title: card.title,
      description: card.description,
      assignee: card.assignee,
      labels: [...card.labels],
      createdAt: card.createdAt,
      updatedAt: card.updatedAt
    }]))
  };
}

function importBoard(board, record) {
  if (!record || record.version !== 1) throw new Error('Unsupported board record');
  board.load(record);
  return board.getState();
}

module.exports = { exportBoard, importBoard };
