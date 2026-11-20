'use strict';

const COLUMN_DEFINITIONS = [
  { id: 'inbox', title: 'Inbox' },
  { id: 'active', title: 'In progress' },
  { id: 'done', title: 'Done' }
];

const SEED_CARDS = [
  {
    id: 'briefing',
    title: 'Outline Monday briefing',
    description: 'Gather the open questions before the weekly check-in.',
    assignee: 'Mara',
    labels: ['review'],
    createdAt: '2025-01-06T09:00:00.000Z',
    updatedAt: '2025-01-06T09:00:00.000Z'
  },
  {
    id: 'wireframe',
    title: 'Polish mobile wireframe',
    description: 'Check the handoff at the narrowest supported width.',
    assignee: 'Theo',
    labels: [],
    createdAt: '2025-01-06T09:15:00.000Z',
    updatedAt: '2025-01-06T09:15:00.000Z'
  },
  {
    id: 'invoice',
    title: 'Send partner invoice',
    description: 'Confirm the purchase order number with finance.',
    assignee: 'Mara',
    labels: ['urgent'],
    createdAt: '2025-01-05T15:30:00.000Z',
    updatedAt: '2025-01-07T10:00:00.000Z'
  }
];

let state = makeInitialState();
let nextNumber = 1;
const listeners = [];

function makeInitialState() {
  return {
    columns: COLUMN_DEFINITIONS.map((column) => ({ ...column, cardIds: [] })),
    cards: {},
    filter: '',
    selectedCardId: null,
    draft: null,
    undoStack: []
  };
}

function seedState() {
  const next = makeInitialState();
  for (const card of SEED_CARDS) next.cards[card.id] = { ...card, labels: [...card.labels] };
  next.columns[0].cardIds = ['briefing', 'wireframe'];
  next.columns[1].cardIds = ['invoice'];
  return next;
}

state = seedState();

function notify() {
  for (const listener of listeners.slice()) listener(state);
}

function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
  };
}

function snapshotForUndo() {
  return {
    columns: state.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
    cards: Object.fromEntries(Object.entries(state.cards).map(([id, card]) => [id, { ...card, labels: [...card.labels] }])),
    filter: state.filter,
    selectedCardId: state.selectedCardId
  };
}

function remember() {
  state.undoStack = [...state.undoStack, snapshotForUndo()].slice(-25);
}

function cardMatches(card, filter) {
  if (!filter) return true;
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return [card.title, card.description, card.assignee, ...card.labels]
    .filter(Boolean)
    .some((part) => String(part).toLowerCase().includes(needle));
}

function cardIsVisible(id, filter = state.filter) {
  const card = state.cards[id];
  return Boolean(card && cardMatches(card, filter));
}

function getState() {
  return state;
}

function getCard(id) {
  return state.cards[id] || null;
}

function getColumns() {
  return state.columns;
}

function addCard(input, columnId = 'inbox') {
  const column = state.columns.find((item) => item.id === columnId);
  if (!column) throw new Error(`Unknown column: ${columnId}`);
  const data = input || {};
  const id = data.id || `card-${nextNumber++}`;
  if (state.cards[id]) throw new Error(`Card already exists: ${id}`);
  const now = new Date().toISOString();
  remember();
  state.cards[id] = {
    id,
    title: String(data.title || 'Untitled card').trim(),
    description: String(data.description || '').trim(),
    assignee: data.assignee || '',
    labels: Array.isArray(data.labels) ? [...data.labels] : [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now
  };
  remember();
  column.cardIds.push(id);
  notify();
  return state.cards[id];
}

function updateCard(id, changes) {
  const card = state.cards[id];
  if (!card) return null;
  const next = changes || {};
  remember();
  state.cards[id] = {
    ...card,
    ...next,
    id,
    title: next.title === undefined ? card.title : String(next.title).trim(),
    labels: next.labels === undefined ? [...card.labels] : [...next.labels],
    updatedAt: next.updatedAt || new Date().toISOString()
  };
  notify();
  return state.cards[id];
}

function removeCard(id) {
  if (!state.cards[id]) return false;
  remember();
  delete state.cards[id];
  for (const column of state.columns) {
    column.cardIds = column.cardIds.filter((cardId) => cardId !== id);
  }
  if (state.selectedCardId === id) state.selectedCardId = null;
  if (state.draft && state.draft.id === id) state.draft = null;
  notify();
  return true;
}

function moveCard(id, columnId, requestedIndex) {
  const destination = state.columns.find((column) => column.id === columnId);
  if (!destination || !state.cards[id]) return false;
  const source = state.columns.find((column) => column.cardIds.includes(id));
  if (!source) return false;
  const oldIndex = source.cardIds.indexOf(id);
  let index = requestedIndex === undefined ? destination.cardIds.length : Number(requestedIndex);
  if (!Number.isFinite(index)) index = destination.cardIds.length;
  index = Math.max(0, Math.min(Math.floor(index), destination.cardIds.length));
  if (source === destination && index === oldIndex) return false;
  remember();
  source.cardIds.splice(oldIndex, 1);
  destination.cardIds.splice(index, 0, id);
  notify();
  return true;
}

function setFilter(value) {
  const filter = value == null ? '' : String(value);
  if (filter === state.filter) return;
  remember();
  state.filter = filter;
  if (state.selectedCardId && !cardIsVisible(state.selectedCardId, filter)) state.selectedCardId = null;
  notify();
}

function selectCard(id) {
  const next = id && cardIsVisible(id) ? id : null;
  if (next === state.selectedCardId) return;
  remember();
  state.selectedCardId = next;
  notify();
}

function beginEdit(id) {
  const card = state.cards[id];
  if (!card) return null;
  state.draft = { ...card, labels: [...card.labels] };
  notify();
  return state.draft;
}

function updateDraft(changes) {
  if (!state.draft) return null;
  state.draft = { ...state.draft, ...(changes || {}) };
  if (changes && changes.labels) state.draft.labels = [...changes.labels];
  notify();
  return state.draft;
}

function commitEdit() {
  if (!state.draft || !state.cards[state.draft.id]) return null;
  const draft = state.draft;
  state.draft = null;
  return updateCard(draft.id, draft);
}

function cancelEdit() {
  if (!state.draft) return;
  state.draft = null;
  notify();
}

function undo() {
  const previous = state.undoStack[state.undoStack.length - 1];
  if (!previous) return false;
  state = {
    ...state,
    columns: previous.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
    cards: Object.fromEntries(Object.entries(previous.cards).map(([id, card]) => [id, { ...card, labels: [...card.labels] }])),
    filter: previous.filter,
    selectedCardId: previous.selectedCardId,
    undoStack: state.undoStack.slice(0, -1)
  };
  notify();
  return true;
}

function reset() {
  state = seedState();
  nextNumber = 1;
  notify();
}

function load(record) {
  if (!record || !Array.isArray(record.columns) || !record.cards) throw new TypeError('Invalid board record');
  state = {
    columns: record.columns.map((column) => ({ id: column.id, title: column.title, cardIds: [...column.cardIds] })),
    cards: Object.fromEntries(Object.entries(record.cards).map(([id, card]) => [id, { ...card, labels: [...(card.labels || [])] }])),
    filter: '',
    selectedCardId: null,
    draft: null,
    undoStack: []
  };
  notify();
}

function columnView(columnId) {
  const column = state.columns.find((item) => item.id === columnId);
  if (!column) return null;
  const cards = column.cardIds
    .map((id) => state.cards[id])
    .filter((card) => cardMatches(card, state.filter))
    .map((card) => ({ ...card, selected: card.id === state.selectedCardId, badge: cardBadge(card) }));
  return { id: column.id, title: column.title, cards, count: cards.length };
}

function cardBadge(cardOrId) {
  const card = typeof cardOrId === 'string' ? state.cards[cardOrId] : cardOrId;
  if (!card) return { text: 'Missing', tone: 'muted' };
  if (card.labels.includes('urgent')) return { text: 'Urgent', tone: 'coral' };
  if (card.labels.includes('blocked')) return { text: 'Blocked', tone: 'slate' };
  if (card.labels.includes('review')) return { text: 'Review', tone: 'violet' };
  return { text: 'Open', tone: 'plain' };
}

module.exports = {
  getState,
  getCard,
  getColumns,
  subscribe,
  addCard,
  updateCard,
  removeCard,
  moveCard,
  setFilter,
  selectCard,
  beginEdit,
  updateDraft,
  commitEdit,
  cancelEdit,
  undo,
  reset,
  load,
  columnView,
  cardBadge
};
