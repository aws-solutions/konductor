'use strict';

/** done <id>: marks a book as read. */
module.exports = function done(args, store) {
  const book = store.get(args[0]);
  book.read = true;
  return `${book.id} read`;
};
