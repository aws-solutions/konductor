'use strict';

function capitalize(s) {
  const clean = s.trim().replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function truncate(s, max) {
  const clean = s.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 3) + '...';
}

function initials(s) {
  const clean = s.trim().replace(/\s+/g, ' ');
  if (clean === '') return '';
  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

module.exports = { capitalize, truncate, initials };
