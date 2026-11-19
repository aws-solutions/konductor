'use strict';

class SieveError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SieveError';
    this.code = code;
  }
}

module.exports = { SieveError };
