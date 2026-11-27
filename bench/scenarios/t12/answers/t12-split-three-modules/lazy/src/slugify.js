'use strict';

// See docs/specs/slugify.md.
function slugify(text, { maxLength = 60 } = {}) {
  if (typeof text !== 'string') throw new TypeError('slugify: text must be a string');
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new RangeError('slugify: maxLength must be an integer of 1 or more');
  let s = text.normalize('NFD').replace(/\p{M}+/gu, '').replace(/ß/g, 'ss').replace(/Æ/g, 'AE').replace(/æ/g, 'ae').toLowerCase();
  s = s.replace(/&/g, '-and-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > maxLength) {
    const cut = s.slice(0, maxLength + 1).lastIndexOf('-');
    s = cut > 0 ? s.slice(0, cut) : s.slice(0, maxLength);
    s = s.replace(/-+$/, '');
  }
  return s || 'n-a';
}

module.exports = { slugify };
