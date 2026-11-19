'use strict';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class CouponError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CouponError';
  }
}

module.exports = { ValidationError, CouponError };
