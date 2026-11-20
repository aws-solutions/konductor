'use strict';

const MAX_TAGS = 5;

/** tag <id> <tag>: adds a lower-case tag to a book, at most 5 per book. */
module.exports = function tag(args, store) {
  const [id, raw] = args;
  const name = raw ? raw.replace(/^#/, '').toLowerCase() : '';
  if (!id || !name) throw new Error('usage: tag <id> <tag>');
  const book = store.get(id);
  if (book.tags.includes(name)) return `${id} already has #${name}`;
  if (book.tags.length >= MAX_TAGS) throw new Error(`${id} already has ${MAX_TAGS} tags`);
  book.tags.push(name);
  return `${id} tagged #${name}`;
};
