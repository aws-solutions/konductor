'use strict';

function createStore(initialState) {
  let value = initialState;
  const observers = new Set();

  const getState = () => value;
  const setState = (change) => {
    const patch = typeof change === 'function' ? change(value) : change;
    value = Object.assign({}, value, patch || {});
    for (const observer of [...observers]) observer(value);
    return value;
  };
  const subscribe = (observer) => {
    if (typeof observer !== 'function') throw new TypeError('listener must be a function');
    observers.add(observer);
    return () => observers.delete(observer);
  };

  return { getState, setState, subscribe };
}

module.exports = { createStore };
