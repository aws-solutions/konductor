'use strict';

const { createStore } = require('./store/createStore');
const { boardActions } = require('./store/boardActions');

const defaultStore = createStore({});
const defaultActions = boardActions(defaultStore);
defaultActions.reset();
let activeStore = defaultStore;
let activeActions = defaultActions;

function _useStore(store) {
  if (store === undefined || store === null) {
    activeStore = defaultStore;
    activeActions = defaultActions;
    return activeStore;
  }
  if (!store || typeof store.getState !== 'function' || typeof store.setState !== 'function' || typeof store.subscribe !== 'function') {
    throw new TypeError('store must implement getState, setState, and subscribe');
  }
  activeStore = store;
  activeActions = boardActions(store);
  return activeStore;
}

function getState() { return activeStore.getState(); }
function getCard(id) { return activeActions.getCard(id); }
function getColumns() { return activeActions.getColumns(); }
function subscribe(listener) { return activeStore.subscribe(listener); }
function addCard(input, columnId) { return activeActions.addCard(input, columnId); }
function updateCard(id, changes) { return activeActions.updateCard(id, changes); }
function removeCard(id) { return activeActions.removeCard(id); }
function moveCard(id, columnId, index) { return activeActions.moveCard(id, columnId, index); }
function setFilter(value) { return activeActions.setFilter(value); }
function selectCard(id) { return activeActions.selectCard(id); }
function beginEdit(id) { return activeActions.beginEdit(id); }
function updateDraft(changes) { return activeActions.updateDraft(changes); }
function commitEdit() { return activeActions.commitEdit(); }
function cancelEdit() { return activeActions.cancelEdit(); }
function undo() { return activeActions.undo(); }
function reset() { return activeActions.reset(); }
function load(record) { return activeActions.load(record); }

function cardBadge(cardOrId) {
  const card = typeof cardOrId === 'string' ? getCard(cardOrId) : cardOrId;
  if (!card) return { text: 'Missing', tone: 'muted' };
  if (card.labels.includes('urgent')) return { text: 'Urgent', tone: 'coral' };
  if (card.labels.includes('blocked')) return { text: 'Blocked', tone: 'slate' };
  if (card.labels.includes('review')) return { text: 'Review', tone: 'violet' };
  return { text: 'Open', tone: 'plain' };
}

function columnView(columnId) {
  const column = getColumns().find((item) => item.id === columnId);
  if (!column) return null;
  const cards = column.cardIds
    .map((id) => getCard(id))
    .filter((card) => activeActions.cardMatches(card, getState().filter))
    .map((card) => ({ ...card, selected: card.id === getState().selectedCardId, badge: cardBadge(card) }));
  return { id: column.id, title: column.title, cards, count: cards.length };
}

module.exports = {
  getState, getCard, getColumns, subscribe, addCard, updateCard, removeCard, moveCard,
  setFilter, selectCard, beginEdit, updateDraft, commitEdit, cancelEdit, undo, reset, load,
  columnView, cardBadge, _useStore
};
