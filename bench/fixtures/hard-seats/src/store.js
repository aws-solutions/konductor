'use strict';

// Every call waits one turn of the event loop, like the network store it stands in for, so other calls run in between.
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** In-memory async key-value store. A value of undefined deletes the key. */
function createStore() {
  const data = new Map();
  return {
    async get(key) {
      await turn();
      return data.get(key);
    },
    async set(key, value) {
      await turn();
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
  };
}

module.exports = { createStore };
