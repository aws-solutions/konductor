'use strict';

const { createStore } = require('./store/createStore');
const { boardActions } = require('./store/boardActions');

const builtInStore = createStore({});
const builtInActions = boardActions(builtInStore);
builtInActions.reset();
let selectedStore = builtInStore;
let selectedActions = builtInActions;

function _useStore(store) {
  if (store === undefined || store === null) {
    selectedStore = builtInStore;
    selectedActions = builtInActions;
    return selectedStore;
  }
  if (!store || typeof store.getState !== 'function' || typeof store.setState !== 'function' || typeof store.subscribe !== 'function') {
    throw new TypeError('store must implement getState, setState, and subscribe');
  }
  selectedStore = store;
  selectedActions = boardActions(store);
  return selectedStore;
}

function getState() { return selectedStore.getState(); }
function getCard(id) { return selectedActions.getCard(id); }
function getColumns() { return selectedActions.getColumns(); }
function subscribe(listener) { return selectedStore.subscribe(listener); }
function addCard(input, columnId) { return selectedActions.addCard(input, columnId); }
function updateCard(id, changes) { return selectedActions.updateCard(id, changes); }
function removeCard(id) { return selectedActions.removeCard(id); }
function moveCard(id, columnId, index) { return selectedActions.moveCard(id, columnId, index); }
function setFilter(value) { return selectedActions.setFilter(value); }
function selectCard(id) { return selectedActions.selectCard(id); }
function beginEdit(id) { return selectedActions.beginEdit(id); }
function updateDraft(changes) { return selectedActions.updateDraft(changes); }
function commitEdit() { return selectedActions.commitEdit(); }
function cancelEdit() { return selectedActions.cancelEdit(); }
function undo() { return selectedActions.undo(); }
function reset() { return selectedActions.reset(); }
function load(record) { return selectedActions.load(record); }

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
    .filter((card) => selectedActions.cardMatches(card, getState().filter))
    .map((card) => ({ ...card, selected: card.id === getState().selectedCardId, badge: cardBadge(card) }));
  return { id: column.id, title: column.title, cards, count: cards.length };
}

module.exports = {
  getState, getCard, getColumns, subscribe, addCard, updateCard, removeCard, moveCard,
  setFilter, selectCard, beginEdit, updateDraft, commitEdit, cancelEdit, undo, reset, load,
  columnView, cardBadge, _useStore
};
