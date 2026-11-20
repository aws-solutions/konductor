'use strict';

function encodeCardDrag(cardId, columnId) {
  return JSON.stringify({ kind: 'cornerstone-card', cardId, columnId });
}

function decodeCardDrag(value) {
  if (typeof value !== 'string') return null;
  try {
    const payload = JSON.parse(value);
    if (payload.kind !== 'cornerstone-card' || !payload.cardId) return null;
    return { cardId: payload.cardId, columnId: payload.columnId || null };
  } catch (error) {
    return null;
  }
}

function dropCard(board, value, columnId, index) {
  const payload = decodeCardDrag(value);
  if (!payload || !board.getCard(payload.cardId)) return false;
  return board.moveCard(payload.cardId, columnId, index);
}

module.exports = { encodeCardDrag, decodeCardDrag, dropCard };
