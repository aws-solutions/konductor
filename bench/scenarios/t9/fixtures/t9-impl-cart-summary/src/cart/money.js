const CURRENCY_DIGITS = new Map([
  ['BHD', 3], ['IQD', 3], ['JOD', 3], ['KWD', 3], ['LYD', 3], ['OMR', 3], ['TND', 3],
  ['BIF', 0], ['CLP', 0], ['DJF', 0], ['GNF', 0], ['ISK', 0], ['JPY', 0], ['KMF', 0], ['KRW', 0], ['PYG', 0], ['RWF', 0], ['UGX', 0], ['VND', 0], ['VUV', 0], ['XAF', 0], ['XOF', 0], ['XPF', 0]
]);

export function currencyDigits(currency) {
  return CURRENCY_DIGITS.has(currency) ? CURRENCY_DIGITS.get(currency) : 2;
}

export function formatMoney(minor, locale = 'en-US', currency = 'USD') {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits
  }).format(minor / (10 ** digits));
}

export function roundHalfAwayFromZero(numerator, denominator = 1) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) throw new RangeError('Cannot round this amount');
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(numerator) / Math.abs(denominator) + 0.5);
}
