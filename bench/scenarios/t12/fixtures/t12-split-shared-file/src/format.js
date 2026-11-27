'use strict';

// Formatting for invoice lines. Money is integer cents.
const SYMBOL = { EUR: '€', GBP: '£', USD: '$' };

function formatMoney(cents, currency = 'USD') {
  if (!Number.isInteger(cents)) throw new TypeError('formatMoney: cents must be an integer');
  const symbol = SYMBOL[currency];
  if (!symbol) throw new RangeError(`formatMoney: unknown currency ${currency}`);
  const abs = Math.abs(cents);
  const text = `${symbol}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new RangeError(`formatDate: ${iso} is not YYYY-MM-DD`);
  return iso;
}

module.exports = { formatMoney, formatDate };
