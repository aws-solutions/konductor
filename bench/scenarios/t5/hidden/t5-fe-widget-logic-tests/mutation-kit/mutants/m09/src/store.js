'use strict';

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(update) {
    const next = typeof update === 'function' ? update(state) : update;
    state = next;
    listeners.forEach((listener) => listener(state));
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

module.exports = { createStore };
