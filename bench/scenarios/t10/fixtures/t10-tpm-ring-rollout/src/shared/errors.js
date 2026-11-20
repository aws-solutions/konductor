'use strict';

class ReceiptError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'ReceiptError';
    this.code = code;
    this.status = status;
  }
}

module.exports = { ReceiptError };
