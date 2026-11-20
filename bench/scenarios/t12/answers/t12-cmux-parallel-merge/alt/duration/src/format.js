'use strict';

/** Reading time for people: "45m", "1h 30m", "2h" (whole minutes, rounded). */
function formatDuration(minutes) {
  const whole = Math.round(minutes);
  const parts = [];
  if (whole >= 60) parts.push(`${Math.trunc(whole / 60)}h`);
  if (whole % 60 || whole < 60) parts.push(`${whole % 60}m`);
  return parts.join(' ');
}

/** One line of the book list. */
function bookLine(book) {
  const mark = book.read ? 'x' : ' ';
  const tags = book.tags.length ? ` #${book.tags.join(' #')}` : '';
  return `[${mark}] ${book.id} ${book.title} (${formatDuration(book.minutes)})${tags}`;
}

module.exports = { formatDuration, bookLine };
