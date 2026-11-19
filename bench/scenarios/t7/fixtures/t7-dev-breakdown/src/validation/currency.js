function isCurrencyCode(value) { return /^[A-Z]{3}$/.test(value); }
module.exports = { isCurrencyCode };
