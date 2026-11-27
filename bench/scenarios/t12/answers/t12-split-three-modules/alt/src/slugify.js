'use strict';

// See docs/specs/slugify.md. Each spec rule is one step, in the spec's order.
const DEFAULT_MAX_LENGTH = 60;
const EMPTY = 'n-a';
const SPECIAL = { ß: 'ss', æ: 'ae', Æ: 'ae' };

const stripAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[ßæÆ]/g, (c) => SPECIAL[c]);

function shorten(slug, maxLength) {
  if (slug.length <= maxLength) return slug;
  const head = slug.slice(0, maxLength);
  const breakAt = slug[maxLength] === '-' ? maxLength : head.lastIndexOf('-');
  return (breakAt > 0 ? head.slice(0, breakAt) : head).replace(/-+$/, '');
}

function slugify(text, { maxLength = DEFAULT_MAX_LENGTH } = {}) {
  if (typeof text !== 'string') throw new TypeError('slugify: expected a string');
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new RangeError(`slugify: maxLength must be an integer of 1 or more, got ${maxLength}`);
  const words = stripAccents(text).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  return shorten(words.join('-'), maxLength) || EMPTY;
}

module.exports = { slugify };
