'use strict';

// Formatting for invoice lines. Money is integer cents.
const SYMBOL = { EUR: '€', GBP: '£', USD: '$' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatMoney(cents, currency = 'USD', { accounting = false } = {}) {
  if (!Number.isInteger(cents)) throw new TypeError('formatMoney: cents must be an integer');
  const symbol = SYMBOL[currency];
  if (!symbol) throw new RangeError(`formatMoney: unknown currency ${currency}`);
  const abs = Math.abs(cents);
  const text = `${symbol}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  if (cents >= 0) return text;
  return accounting ? `(${text})` : `-${text}`;
}

function formatDate(iso, style = 'iso') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new RangeError(`formatDate: ${iso} is not YYYY-MM-DD`);
  if (style === 'iso') return iso;
  if (style !== 'long') throw new RangeError(`formatDate: unknown style ${style}`);
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

module.exports = { formatMoney, formatDate };
