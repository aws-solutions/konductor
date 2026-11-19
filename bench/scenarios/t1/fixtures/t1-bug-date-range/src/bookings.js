const fs = require('node:fs');
const { validateBooking } = require('./validation');
const { overlaps } = require('./date-range');

class BookingConflictError extends Error {
  constructor() {
    super('booking overlaps an existing booking');
    this.name = 'BookingConflictError';
  }
}

function readBookings(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(value)) throw new TypeError('booking file must contain an array');
  return value;
}

function writeBookings(filePath, bookings) {
  fs.writeFileSync(filePath, `${JSON.stringify(bookings, null, 2)}\n`);
}

function hasConflict(candidate, bookings) {
  validateBooking(candidate);
  return bookings.some(existing => existing.room === candidate.room &&
    existing.id !== candidate.id &&
    overlaps(candidate.start, candidate.end, existing.start, existing.end));
}

function addBooking(filePath, candidate) {
  validateBooking(candidate);
  const bookings = readBookings(filePath);
  if (hasConflict(candidate, bookings)) throw new BookingConflictError();
  bookings.push(candidate);
  writeBookings(filePath, bookings);
  return candidate;
}

module.exports = { BookingConflictError, readBookings, writeBookings, hasConflict, addBooking };
