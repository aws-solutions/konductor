'use strict';

// Formatting for invoice lines. Money is integer cents.
const SYMBOL = { EUR: '€', GBP: '£', USD: '$' };
const LONG_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function formatMoney(cents, currency = 'USD', options = {}) {
  if (!Number.isInteger(cents)) throw new TypeError('formatMoney: cents must be an integer');
  const symbol = SYMBOL[currency];
  if (!symbol) throw new RangeError(`formatMoney: unknown currency ${currency}`);
  const abs = Math.abs(cents);
  const text = `${symbol}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  if (cents >= 0) return text;
  return options.accounting === true ? `(${text})` : `-${text}`;
}

const STYLES = {
  iso: (iso) => iso,
  long: (iso) => LONG_DATE.format(new Date(`${iso}T00:00:00Z`)),
};

function formatDate(iso, style = 'iso') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new RangeError(`formatDate: ${iso} is not YYYY-MM-DD`);
  if (!Object.hasOwn(STYLES, style)) throw new RangeError(`formatDate: style must be 'iso' or 'long', got ${style}`);
  return STYLES[style](iso);
}

module.exports = { formatMoney, formatDate };
