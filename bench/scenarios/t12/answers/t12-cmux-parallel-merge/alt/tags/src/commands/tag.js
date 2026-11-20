'use strict';

const LIMIT = 5;
const normalise = (tag) => String(tag).trim().replace(/^#+/, '').toLowerCase();

/** tag <id> <tag>: one more tag on a book. */
module.exports = function tag([id, given], store) {
  if (!id || !given || !normalise(given)) throw new Error('usage: tag <id> <tag>');
  const book = store.get(id);
  const t = normalise(given);
  if (new Set(book.tags).has(t)) return `${book.id} already has #${t}`;
  if (book.tags.length === LIMIT) throw new Error(`${book.id} already has ${LIMIT} tags`);
  book.tags = [...book.tags, t];
  return `${book.id} tagged #${t}`;
};
