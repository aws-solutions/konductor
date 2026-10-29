'use strict';

// Total in major units to whole cents, rounded half up on the decimal value as written.
function centsFromTotal(total) {
  const text = typeof total === 'number' ? String(total) : typeof total === 'string' ? total.trim() : '';
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error('invalid total');
  const frac = (m[2] || '').padEnd(3, '0');
  return Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (frac[2] >= '5' ? 1 : 0);
}

module.exports = { centsFromTotal };
