'use strict';

function currencyDigits(locale, currency) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
}

function formatPrice(amount, locale = 'en-US', currency = 'USD') {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be finite');
  const digits = currencyDigits(locale, currency);
  const factor = 10 ** digits;
  const rounded = Math.round((amount + Number.EPSILON) * factor) / factor;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rounded);
}

function formatRange(low, high, locale, currency) {
  if (low > high) throw new RangeError('low price must not exceed high price');
  return `${formatPrice(low, locale, currency)} – ${formatPrice(high, locale, currency)}`;
}

module.exports = { formatPrice, formatRange, currencyDigits };
