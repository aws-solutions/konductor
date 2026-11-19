'use strict';
class InputError extends Error { constructor(message) { super(message); this.name = 'InputError'; } }
class RetryableError extends Error { constructor(message) { super(message); this.name = 'RetryableError'; } }
module.exports = { InputError, RetryableError };
