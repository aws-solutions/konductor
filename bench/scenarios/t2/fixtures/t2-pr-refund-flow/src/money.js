export function asMinorUnits(value, exponent = 2) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) {
    throw new TypeError('amount must be a decimal string');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > exponent) throw new RangeError('too many decimal places');
  return Number(whole) * (10 ** exponent) + Number(fraction.padEnd(exponent, '0'));
}

export function formatMinorUnits(value, exponent = 2) {
  return (value / (10 ** exponent)).toFixed(exponent);
}

export function roundToMinor(value, exponent = 2) {
  return Math.round(value * (10 ** exponent));
}
