'use strict';

/** A catalog call that failed. `code` says why, for example SUPPLIER_UNAVAILABLE. */
class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

module.exports = { CatalogError };
