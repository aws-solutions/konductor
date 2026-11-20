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

function freshState() {
  return {
    columns: COLUMN_DEFINITIONS.map((column) => ({ ...column, cardIds: [] })),
    cards: {},
    filter: '',
    selectedCardId: null,
    draft: null,
    undoStack: []
  };
}

function defaultBoard() {
  const next = freshState();
  for (const card of SEED_CARDS) next.cards[card.id] = { ...card, labels: [...card.labels] };
  next.columns[0].cardIds = ['briefing', 'wireframe'];
  next.columns[1].cardIds = ['invoice'];
  return next;
}

function duplicateCard(card) {
  return { ...card, labels: [...card.labels] };
}

function duplicateSnapshot(snapshot) {
  return {
    columns: snapshot.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
    cards: Object.fromEntries(Object.entries(snapshot.cards).map(([id, card]) => [id, duplicateCard(card)])),
    filter: snapshot.filter,
    selectedCardId: snapshot.selectedCardId
  };
}

function duplicateState(state) {
  return {
    columns: state.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
    cards: Object.fromEntries(Object.entries(state.cards).map(([id, card]) => [id, duplicateCard(card)])),
    filter: state.filter,
    selectedCardId: state.selectedCardId,
    draft: state.draft ? duplicateCard(state.draft) : state.draft,
    undoStack: state.undoStack.map(duplicateSnapshot)
  };
}

function historyEntry(state) {
  return {
    columns: state.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
    cards: Object.fromEntries(Object.entries(state.cards).map(([id, card]) => [id, duplicateCard(card)])),
    filter: state.filter,
    selectedCardId: state.selectedCardId
  };
}

function record(state) {
  state.undoStack = [...state.undoStack, historyEntry(state)].slice(-25);
}

function fitsFilter(card, filter) {
  if (!filter) return true;
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return [card.title, card.description, card.assignee, ...card.labels]
    .filter(Boolean)
    .some((part) => String(part).toLowerCase().includes(needle));
}

function boardActions(store) {
  let serial = 1;

  function read() {
    return store.getState();
  }

  function transact(mutator) {
    let result;
    store.setState((current) => {
      const next = duplicateState(current);
      result = mutator(next);
      return next;
    });
    return result;
  }

  function getState() {
    return read();
  }

  function getCard(id) {
    return read().cards[id] || null;
  }

  function getColumns() {
    return read().columns;
  }

  function addCard(input, columnId = 'inbox') {
    const current = read();
    const column = current.columns.find((item) => item.id === columnId);
    if (!column) throw new Error(`Unknown column: ${columnId}`);
    const data = input || {};
    const id = data.id || `card-${serial++}`;
    if (current.cards[id]) throw new Error(`Card already exists: ${id}`);
    const now = new Date().toISOString();
    return transact((next) => {
      record(next);
      next.cards[id] = {
        id,
        title: String(data.title || 'Untitled card').trim(),
        description: String(data.description || '').trim(),
        assignee: data.assignee || '',
        labels: Array.isArray(data.labels) ? [...data.labels] : [],
        createdAt: data.createdAt || now,
        updatedAt: data.updatedAt || now
      };
      record(next);
      next.columns.find((item) => item.id === columnId).cardIds.push(id);
      return next.cards[id];
    });
  }

  function updateCard(id, changes) {
    if (!read().cards[id]) return null;
    const nextChanges = changes || {};
    return transact((next) => {
      const card = next.cards[id];
      record(next);
      next.cards[id] = {
        ...card,
        ...nextChanges,
        id,
        title: nextChanges.title === undefined ? card.title : String(nextChanges.title).trim(),
        labels: nextChanges.labels === undefined ? [...card.labels] : [...nextChanges.labels],
        updatedAt: nextChanges.updatedAt || new Date().toISOString()
      };
      return next.cards[id];
    });
  }

  function removeCard(id) {
    if (!read().cards[id]) return false;
    return transact((next) => {
      record(next);
      delete next.cards[id];
      for (const column of next.columns) {
        column.cardIds = column.cardIds.filter((cardId) => cardId !== id);
      }
      if (next.selectedCardId === id) next.selectedCardId = null;
      if (next.draft && next.draft.id === id) next.draft = null;
      return true;
    });
  }

  function moveCard(id, columnId, requestedIndex) {
    const current = read();
    const destination = current.columns.find((column) => column.id === columnId);
    if (!destination || !current.cards[id]) return false;
    const source = current.columns.find((column) => column.cardIds.includes(id));
    if (!source) return false;
    const oldIndex = source.cardIds.indexOf(id);
    let index = requestedIndex === undefined ? destination.cardIds.length : Number(requestedIndex);
    if (!Number.isFinite(index)) index = destination.cardIds.length;
    index = Math.max(0, Math.min(Math.floor(index), destination.cardIds.length));
    if (source === destination && index === oldIndex) return false;
    return transact((next) => {
      const from = next.columns.find((column) => column.cardIds.includes(id));
      const to = next.columns.find((column) => column.id === columnId);
      record(next);
      from.cardIds.splice(from.cardIds.indexOf(id), 1);
      to.cardIds.splice(index, 0, id);
      return true;
    });
  }

  function setFilter(value) {
    const filter = value == null ? '' : String(value);
    if (filter === read().filter) return;
    transact((next) => {
      record(next);
      next.filter = filter;
      if (next.selectedCardId && !cardIsVisible(next.selectedCardId, filter, next)) next.selectedCardId = null;
    });
  }

  function cardIsVisible(id, filter = read().filter, current = read()) {
    const card = current.cards[id];
    return Boolean(card && fitsFilter(card, filter));
  }

  function selectCard(id) {
    const nextId = id && cardIsVisible(id) ? id : null;
    if (nextId === read().selectedCardId) return;
    transact((next) => {
      record(next);
      next.selectedCardId = nextId;
    });
  }

  function beginEdit(id) {
    const card = read().cards[id];
    if (!card) return null;
    return transact((next) => {
      next.draft = duplicateCard(next.cards[id]);
      return next.draft;
    });
  }

  function updateDraft(changes) {
    if (!read().draft) return null;
    return transact((next) => {
      next.draft = { ...next.draft, ...(changes || {}) };
      if (changes && changes.labels) next.draft.labels = [...changes.labels];
      return next.draft;
    });
  }

  function commitEdit() {
    const current = read();
    if (!current.draft || !current.cards[current.draft.id]) return null;
    const draft = current.draft;
    return transact((next) => {
      next.draft = null;
      const card = next.cards[draft.id];
      record(next);
      next.cards[draft.id] = {
        ...card,
        ...draft,
        id: draft.id,
        title: draft.title === undefined ? card.title : String(draft.title).trim(),
        labels: draft.labels === undefined ? [...card.labels] : [...draft.labels],
        updatedAt: draft.updatedAt || new Date().toISOString()
      };
      return next.cards[draft.id];
    });
  }

  function cancelEdit() {
    if (!read().draft) return;
    transact((next) => {
      next.draft = null;
    });
  }

  function undo() {
    const current = read();
    const previous = current.undoStack[current.undoStack.length - 1];
    if (!previous) return false;
    transact((next) => {
      next.columns = previous.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] }));
      next.cards = Object.fromEntries(Object.entries(previous.cards).map(([id, card]) => [id, duplicateCard(card)]));
      next.filter = previous.filter;
      next.selectedCardId = previous.selectedCardId;
      next.undoStack = current.undoStack.slice(0, -1).map(duplicateSnapshot);
      return true;
    });
    return true;
  }

  function reset() {
    serial = 1;
    store.setState(() => defaultBoard());
  }

  function load(record) {
    if (!record || !Array.isArray(record.columns) || !record.cards) throw new TypeError('Invalid board record');
    store.setState(() => ({
      columns: record.columns.map((column) => ({ id: column.id, title: column.title, cardIds: [...column.cardIds] })),
      cards: Object.fromEntries(Object.entries(record.cards).map(([id, card]) => [id, { ...card, labels: [...(card.labels || [])] }])),
      filter: '',
      selectedCardId: null,
      draft: null,
      undoStack: []
    }));
  }

  return {
    getState,
    getCard,
    getColumns,
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
    cardMatches: fitsFilter
  };
}

module.exports = { boardActions };
