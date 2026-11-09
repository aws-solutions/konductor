'use strict';

const roundCents = (n) => Math.round(n * 100) / 100;
const normalizeZip = (z) => String(z).trim().toUpperCase().replace(/\s+/g, '');

module.exports = { roundCents, normalizeZip };
