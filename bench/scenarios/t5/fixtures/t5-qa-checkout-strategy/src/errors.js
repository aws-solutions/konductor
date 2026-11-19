class CheckoutError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
    this.details = details;
  }
}

module.exports = { CheckoutError };
