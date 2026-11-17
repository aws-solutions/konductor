'use strict';

/** An export that cannot be made. `code` is UNKNOWN_FORMAT or BAD_ARGUMENT. */
class ExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

module.exports = { ExportError };
