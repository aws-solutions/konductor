'use strict';

function normalizeSpace(s) {
  return s.trim().replace(/\s+/g, ' ');
}

function capitalize(s) {
  const clean = normalizeSpace(s);
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function truncate(s, max) {
  const clean = normalizeSpace(s);
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 3) + '...';
}

function initials(s) {
  const clean = normalizeSpace(s);
  if (clean === '') return '';
  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

module.exports = { capitalize, truncate, initials };
