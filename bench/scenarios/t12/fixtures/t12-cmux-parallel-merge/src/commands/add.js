'use strict';

/** add <minutes> <title...>: puts a book on the shelf. */
module.exports = function add(args, store) {
  const minutes = Number(args[0]);
  const title = args.slice(1).join(' ').trim();
  if (!Number.isInteger(minutes) || minutes <= 0 || !title) throw new Error('usage: add <minutes> <title>');
  const book = store.add(title, minutes);
  return `added ${book.id}`;
};
