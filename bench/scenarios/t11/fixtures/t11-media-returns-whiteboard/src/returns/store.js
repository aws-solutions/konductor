'use strict';
function createMemoryStore(seed = []) {
  const records = new Map(seed.map((item) => [item.id, { ...item }]));
  return {
    get(id) { return records.get(id); },
    put(item) { records.set(item.id, { ...item }); return { ...records.get(item.id) }; },
    values() { return [...records.values()].map((item) => ({ ...item })); }
  };
}
module.exports = { createMemoryStore };
