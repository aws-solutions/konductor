'use strict';

/** Reading time for people: "45m", "1h 30m". */
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** One line of the book list. */
function bookLine(book) {
  const mark = book.read ? 'x' : ' ';
  const tags = book.tags.length ? ` #${book.tags.join(' #')}` : '';
  return `[${mark}] ${book.id} ${book.title} (${formatDuration(book.minutes)})${tags}`;
}

module.exports = { formatDuration, bookLine };
