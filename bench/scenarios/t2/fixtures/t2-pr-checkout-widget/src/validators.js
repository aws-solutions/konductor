export function isPositiveWholeNumber(value) {
  return Number.isInteger(value) && value > 0;
}

export function isPromoCode(value) {
  return /^[A-Z0-9-]{3,24}$/i.test(value.trim());
}
