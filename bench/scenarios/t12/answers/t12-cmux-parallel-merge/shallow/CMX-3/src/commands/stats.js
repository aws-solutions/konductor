'use strict';

const { formatDuration } = require('../format.js');

/** stats: how many books, how many read, and the reading time left. */
module.exports = function stats(args, store) {
  const books = store.all();
  const unread = books.filter((b) => !b.read);
  const left = unread.reduce((sum, b) => sum + b.minutes, 0);
  return `books: ${books.length}, read: ${books.length - unread.length}, left: ${formatDuration(left)}`;
};
