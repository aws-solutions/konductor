'use strict';

const normZip = (z) => String(z).trim().toUpperCase().replace(/\s+/g, '');
const clean = (v) => (v == null ? '' : String(v).trim());

function normalizeAddress(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid address: expected an object');
  const zip = normZip(raw.zip == null ? '' : raw.zip);
  if (!/^[A-Z0-9]{3,10}$/.test(zip)) throw new Error('invalid address: zip');
  const country = clean(raw.country).toUpperCase() || 'US';
  return { name: clean(raw.name), line1: clean(raw.line1), city: clean(raw.city), zip, country };
}

module.exports = { normalizeAddress };
