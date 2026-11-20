'use strict';

function boardActions(store) {
  let undoState = null;

  function getState() { return store.getState(); }
  function getCard(id) { return getState().cards[id] || null; }
  function getColumns() { return getState().columns; }
  function remember() { undoState = { ...getState(), filter: '', selectedCardId: null, cards: { ...getState().cards } }; }

  function addCard(input, columnId = 'inbox') {
    const state = getState();
    const column = state.columns.find((item) => item.id === columnId);
    if (!column) throw new Error(`Unknown column: ${columnId}`);
    const id = input && input.id ? input.id : `card-${Object.keys(state.cards).length + 1}`;
    remember();
    const card = { id, title: String((input && input.title) || 'Untitled card').trim(), labels: [...((input && input.labels) || [])] };
    store.setState({ cards: { ...state.cards, [id]: card }, columns: state.columns.map((item) => item === column ? { ...item, cardIds: [...item.cardIds, id] } : item) });
    return getCard(id);
  }

  function moveCard(id, columnId, index) {
    const state = getState();
    const destination = state.columns.find((column) => column.id === columnId);
    const source = state.columns.find((column) => column.cardIds.includes(id));
    if (!destination || !source || !getCard(id)) return false;
    remember();
    const columns = state.columns.map((column) => ({ ...column, cardIds: column.cardIds.filter((cardId) => cardId !== id) }));
    const target = columns.find((column) => column.id === columnId);
    target.cardIds.splice(index === undefined ? target.cardIds.length : Number(index), 0, id);
    store.setState({ columns });
    return true;
  }

  function updateCard(id, changes) {
    const card = getCard(id);
    if (!card) return null;
    remember();
    store.setState({ cards: { ...getState().cards, [id]: { ...card, ...(changes || {}), id } } });
    return getCard(id);
  }

  function setFilter(value) { store.setState({ filter: value == null ? '' : String(value) }); }
  function selectCard(id) { store.setState({ selectedCardId: id && getCard(id) ? id : null }); }
  function beginEdit(id) { const card = getCard(id); if (!card) return null; store.setState({ draft: { ...card } }); return getState().draft; }
  function updateDraft(changes) { if (!getState().draft) return null; store.setState({ draft: { ...getState().draft, ...(changes || {}) } }); return getState().draft; }
  function commitEdit() { const draft = getState().draft; if (!draft) return null; store.setState({ draft: null }); return updateCard(draft.id, draft); }
  function cancelEdit() { if (getState().draft) store.setState({ draft: null }); }
  function removeCard(id) { if (!getCard(id)) return false; remember(); const cards = { ...getState().cards }; delete cards[id]; store.setState({ cards }); return true; }
  function undo() { if (!undoState) return false; store.setState(undoState); undoState = null; return true; }
  function reset() { return store.setState({ filter: '', selectedCardId: null, draft: null, undoStack: [] }); }
  function load(record) { if (!record || !Array.isArray(record.columns) || !record.cards) throw new TypeError('Invalid board record'); return store.setState({ ...record, filter: '', selectedCardId: null, draft: null, undoStack: [] }); }

  return { getState, getCard, getColumns, addCard, updateCard, removeCard, moveCard, setFilter, selectCard, beginEdit, updateDraft, commitEdit, cancelEdit, undo, reset, load, cardIsVisible() { return false; }, cardMatches() { return false; } };
}

module.exports = { boardActions };
