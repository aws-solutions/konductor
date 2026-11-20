'use strict';

/** Reading time for people: "45m", "1h 30m", "2h". Rounded to the nearest minute first. */
function formatDuration(minutes) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** One line of the book list. */
function bookLine(book) {
  const mark = book.read ? 'x' : ' ';
  const tags = book.tags.length ? ` #${book.tags.join(' #')}` : '';
  return `[${mark}] ${book.id} ${book.title} (${formatDuration(book.minutes)})${tags}`;
}

module.exports = { formatDuration, bookLine };
