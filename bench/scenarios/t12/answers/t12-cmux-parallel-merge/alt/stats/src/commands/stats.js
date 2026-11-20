'use strict';

const { formatDuration } = require('../format.js');

/** stats: one line about the whole shelf; extra arguments are ignored. */
module.exports = function stats(_args, store) {
  let read = 0;
  let minutesLeft = 0;
  const books = store.all();
  for (const book of books) {
    if (book.read) read += 1;
    else minutesLeft += book.minutes;
  }
  return ['books: ' + books.length, 'read: ' + read, 'left: ' + formatDuration(minutesLeft)].join(', ');
};
