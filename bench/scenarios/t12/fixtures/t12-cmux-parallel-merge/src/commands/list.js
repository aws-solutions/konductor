'use strict';

const { bookLine } = require('../format.js');

/** list: every book, one per line. */
module.exports = function list(args, store) {
  const books = store.all();
  return books.length ? books.map(bookLine).join('\n') : 'the shelf is empty';
};
