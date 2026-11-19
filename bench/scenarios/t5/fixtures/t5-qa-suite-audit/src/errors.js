'use strict';

class BillingError extends Error {
  constructor(message, code = 'billing_error', details = {}) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.details = details;
  }
}

class ValidationError extends BillingError {
  constructor(message, details = {}) { super(message, 'validation_error', details); this.name = 'ValidationError'; }
}

class NotFoundError extends BillingError {
  constructor(message, details = {}) { super(message, 'not_found', details); this.name = 'NotFoundError'; }
}

module.exports = { BillingError, ValidationError, NotFoundError };
