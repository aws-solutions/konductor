'use strict';

// Storage plus a lower-cased text index used by search.
function createRepo() {
  const rows = new Map();
  const index = new Map();
  let seq = 0;
  return {
    nextId: () => `c${++seq}`,
    save(contact) {
      const isNew = !rows.has(contact.id);
      rows.set(contact.id, contact);
      if (isNew) index.set(contact.id, `${contact.displayName}\n${contact.email}`.toLowerCase());
      return contact;
    },
    find: (id) => rows.get(id) ?? null,
    all: () => [...rows.values()],
    searchIds: (needle) => [...index.entries()].filter(([, text]) => text.includes(needle)).map(([id]) => id),
  };
}

module.exports = { createRepo };
