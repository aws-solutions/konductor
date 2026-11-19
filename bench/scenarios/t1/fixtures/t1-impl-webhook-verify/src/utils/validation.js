function isEvent(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 160 &&
    Number.isSafeInteger(value.amount) && value.amount >= 0 &&
    typeof value.currency === 'string' && /^[a-z]{3}$/.test(value.currency));
}

module.exports = { isEvent };
