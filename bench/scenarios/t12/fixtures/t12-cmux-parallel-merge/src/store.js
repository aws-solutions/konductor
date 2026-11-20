'use strict';

/** An in-memory shelf of books: { id, title, minutes, read, tags }. Ids are b1, b2, ... in the order added. */
function createStore(books = []) {
  const list = books.map((b) => ({ read: false, tags: [], ...b }));
  return {
    all: () => list.slice(),
    get(id) {
      const book = list.find((b) => b.id === id);
      if (!book) throw new Error(`no book ${id}`);
      return book;
    },
    add(title, minutes) {
      const book = { id: `b${list.length + 1}`, title, minutes, read: false, tags: [] };
      list.push(book);
      return book;
    },
  };
}

module.exports = { createStore };
