export function centsToNumber(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('price must be non-negative cents');
  return cents / 100;
}

export function numberToCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isInteger(cents) || cents < 0) throw new Error('price must be non-negative');
  return cents;
}
