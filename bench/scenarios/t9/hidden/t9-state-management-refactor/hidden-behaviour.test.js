'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const board = require('./src/board');
function createStore(initialState) {
  return require('./src/store/createStore').createStore(initialState);
}

function boardActions(store) {
  return require('./src/store/boardActions').boardActions(store);
}

function blankState(cards = {}, columns = [{ id: 'inbox', title: 'Inbox', cardIds: Object.keys(cards) }]) {
  return { columns, cards, filter: '', selectedCardId: null, draft: null, undoStack: [] };
}

function oneCardState() {
  return blankState({ one: { id: 'one', title: 'One task', description: '', assignee: '', labels: [] } });
}

test('public board keeps seeded ordering and default card values', () => {
  board.reset();
  assert.deepEqual(board.getState().columns.map((column) => column.id), ['inbox', 'active', 'done']);
  const card = board.addCard({});
  assert.equal(card.id, 'card-1');
  assert.equal(card.title, 'Untitled card');
  assert.equal(card.assignee, '');
  assert.deepEqual(card.labels, []);
});

test('public board preserves movement, filtering, view models, and no-op movement', () => {
  board.reset();
  const card = board.addCard({ title: '  Plan launch  ', labels: ['review'] });
  assert.equal(board.moveCard(card.id, 'done', Infinity), true);
  assert.equal(board.moveCard(card.id, 'done', 0), false);
  board.setFilter('LAUNCH');
  board.selectCard(card.id);
  assert.equal(board.getState().selectedCardId, card.id);
  assert.deepEqual(board.columnView('done').cards[0].badge, { text: 'Review', tone: 'violet' });
  assert.equal(board.columnView('done').count, 1);
  assert.equal(board.moveCard('missing', 'done'), false);
});

test('public board retains the add undo quirk and keeps edit drafts out of history', () => {
  board.reset();
  const added = board.addCard({ title: 'Undo me' });
  assert.equal(board.undo(), true);
  assert.ok(board.getCard(added.id));
  assert.deepEqual(board.getState().columns[0].cardIds, ['briefing', 'wireframe']);
  assert.equal(board.undo(), true);
  assert.equal(board.getCard(added.id), null);

  board.beginEdit('briefing');
  board.updateDraft({ title: 'Temporary', labels: [] });
  assert.equal(board.getCard('briefing').title, 'Outline Monday briefing');
  assert.deepEqual(board.commitEdit().labels, []);
  assert.equal(board.undo(), true);
  assert.equal(board.getCard('briefing').title, 'Outline Monday briefing');
  assert.equal(board.getState().draft, null);
});

test('injected board preserves subscription order and public error types', () => {
  const store = createStore(blankState());
  board._useStore(store);
  assert.throws(() => board.subscribe('not a listener'), { name: 'TypeError' });
  assert.throws(() => board.load(null), { name: 'TypeError' });
  const events = [];
  const first = board.subscribe(() => events.push('first'));
  const second = board.subscribe(() => events.push('second'));
  board.reset();
  second();
  board.reset();
  first();
  assert.deepEqual(events, ['first', 'second', 'first']);
  board._useStore();
  board.reset();
});

test('createStore merges partials and updater results, notifying once per call', () => {
  const store = createStore({ count: 0, label: 'kept' });
  const counts = [];
  store.subscribe((state) => counts.push(state.count));
  store.setState({ count: 1 });
  store.setState((state) => ({ count: state.count + 2 }));
  store.setState({});
  assert.deepEqual(counts, [1, 3, 3]);
  assert.deepEqual(store.getState(), { count: 3, label: 'kept' });
});

test('createStore calls subscribers in order and removes only the requested subscriber', () => {
  const store = createStore({ value: 0 });
  const calls = [];
  const offA = store.subscribe(() => calls.push('a'));
  store.subscribe(() => calls.push('b'));
  store.setState({ value: 1 });
  offA();
  store.setState({ value: 2 });
  assert.deepEqual(calls, ['a', 'b', 'b']);
});

test('createStore rejects non-functions with the documented error type', () => {
  const store = createStore({});
  assert.throws(() => store.subscribe(null), { name: 'TypeError' });
  assert.throws(() => store.subscribe({}), { name: 'TypeError' });
});

test('boardActions is independently usable with a supplied store', () => {
  const store = createStore(blankState());
  const actions = boardActions(store);
  for (const name of ['getCard', 'getColumns', 'addCard', 'updateCard', 'removeCard', 'moveCard', 'setFilter', 'selectCard', 'beginEdit', 'updateDraft', 'commitEdit', 'cancelEdit', 'undo', 'reset', 'load']) {
    assert.equal(typeof actions[name], 'function', name);
  }
  const card = actions.addCard({ title: 'Standalone' });
  assert.equal(actions.moveCard(card.id, 'inbox', 0), false);
  assert.equal(actions.getCard(card.id).title, 'Standalone');
  actions.setFilter('stand');
  actions.selectCard(card.id);
  assert.equal(store.getState().selectedCardId, card.id);
});

test('boardActions preserves undo context while committing edits', () => {
  const store = createStore(oneCardState());
  const actions = boardActions(store);
  actions.setFilter('task');
  actions.selectCard('one');
  actions.beginEdit('one');
  actions.updateDraft({ title: 'Changed' });
  assert.equal(actions.commitEdit().title, 'Changed');
  assert.equal(actions.undo(), true);
  assert.equal(actions.getCard('one').title, 'One task');
  assert.equal(store.getState().filter, 'task');
  assert.equal(store.getState().selectedCardId, 'one');
});

test('board can use an injected store instead of its module default', () => {
  board._useStore();
  board.reset();
  const state = board.getState();
  let setCalls = 0;
  const fake = {
    getState() { return state; },
    setState(update) {
      setCalls += 1;
      const patch = typeof update === 'function' ? update(state) : update;
      Object.assign(state, patch);
      return state;
    },
    subscribe() { return () => {}; }
  };
  board._useStore(fake);
  assert.strictEqual(board.getState(), state);
  board.setFilter('injected');
  assert.equal(state.filter, 'injected');
  assert.equal(setCalls, 1);
  board._useStore();
  board.reset();
});

test('board retains every legacy command while exposing the store hook', () => {
  for (const name of ['getState', 'getCard', 'getColumns', 'subscribe', 'addCard', 'updateCard', 'removeCard', 'moveCard', 'setFilter', 'selectCard', 'beginEdit', 'updateDraft', 'commitEdit', 'cancelEdit', 'undo', 'reset', 'load', 'columnView', 'cardBadge', '_useStore']) {
    assert.equal(typeof board[name], 'function', name);
  }
});

test('board subscription delegates to the currently injected store', () => {
  board._useStore();
  const state = board.getState();
  let subscribed = 0;
  const fake = {
    getState() { return state; },
    setState() {},
    subscribe(listener) {
      subscribed += 1;
      assert.equal(typeof listener, 'function');
      return 'unsubscribed';
    }
  };
  board._useStore(fake);
  const marker = () => {};
  assert.equal(board.subscribe(marker), 'unsubscribed');
  assert.equal(subscribed, 1);
  board._useStore();
});

test('two board action instances do not share state through the module', () => {
  const first = boardActions(createStore(blankState()));
  const second = boardActions(createStore(blankState()));
  first.addCard({ title: 'Only first' });
  assert.equal(first.getCard('card-1').title, 'Only first');
  assert.equal(second.getCard('card-1'), null);
});

test('boardActions load and reset restore independent state defaults', () => {
  const actions = boardActions(createStore(blankState()));
  actions.load({ columns: [{ id: 'inbox', title: 'Inbox', cardIds: [] }], cards: { one: { id: 'one', title: 'Loaded', labels: [] } } });
  assert.equal(actions.getCard('one').title, 'Loaded');
  assert.equal(actions.getState().filter, '');
  actions.setFilter('loaded');
  actions.reset();
  assert.equal(actions.getCard('briefing').title, 'Outline Monday briefing');
  assert.equal(actions.getState().filter, '');
  assert.deepEqual(actions.getState().undoStack, []);
});
