'use strict';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateBooking(values = {}, { maxNoteLength = 120 } = {}) {
  const errors = {};
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const email = typeof values.email === 'string' ? values.email.trim() : '';
  const checkIn = typeof values.checkIn === 'string' ? values.checkIn.trim() : '';
  const checkOut = typeof values.checkOut === 'string' ? values.checkOut.trim() : '';
  const note = typeof values.note === 'string' ? values.note : '';

  if (!name) errors.name = 'Name is required';
  if (!email) errors.email = 'Email is required';
  else if (!EMAIL.test(email)) errors.email = 'Enter a valid email address';
  if (!checkIn) errors.checkIn = 'Check-in date is required';
  else if (!ISO_DATE.test(checkIn)) errors.checkIn = 'Use YYYY-MM-DD for check-in';
  if (!checkOut) errors.checkOut = 'Check-out date is required';
  else if (!ISO_DATE.test(checkOut)) errors.checkOut = 'Use YYYY-MM-DD for check-out';
  if (note.length >= maxNoteLength) errors.note = `Note must be ${maxNoteLength} characters or fewer`;

  return { valid: Object.keys(errors).length === 0, errors };
}

function firstError(result) {
  const key = Object.keys(result.errors)[0];
  return key ? result.errors[key] : null;
}

module.exports = { validateBooking, firstError };
