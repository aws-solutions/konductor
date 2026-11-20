'use strict';

function createStore(initialState) {
  let state = initialState;
  const listeners = [];

  function getState() {
    return state;
  }

  function setState(update) {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...(patch || {}) };
    for (const listener of listeners.slice()) listener(state);
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  return { getState, setState, subscribe };
}

module.exports = { createStore };
