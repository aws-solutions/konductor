'use strict';

/** A booking that could not be made. `code` is one of the codes in docs/BOOKING-SPEC.md. */
class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
  }
}

module.exports = { BookingError };
