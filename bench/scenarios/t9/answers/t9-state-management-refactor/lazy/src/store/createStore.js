'use strict';

function createStore(initialState) {
  let state = initialState;
  const listeners = [];
  return {
    getState() { return state; },
    setState(change) {
      const patch = typeof change === 'function' ? change(state) : change;
      state = { ...state, ...patch };
      if (patch && Object.keys(patch).length > 0) listeners.slice().forEach((listener) => listener(state));
      return state;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.push(listener);
      return () => {};
    }
  };
}

module.exports = { createStore };
