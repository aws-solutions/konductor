'use strict';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

// Checked in this order, so the first error stays the same: [field, required message, pattern, format message].
const FIELDS = [
  ['name', 'Name is required'],
  ['email', 'Email is required', EMAIL, 'Enter a valid email address'],
  ['checkIn', 'Check-in date is required', ISO_DATE, 'Use YYYY-MM-DD for check-in'],
  ['checkOut', 'Check-out date is required', ISO_DATE, 'Use YYYY-MM-DD for check-out'],
];

function validateBooking(values = {}, { maxNoteLength = 120 } = {}) {
  const errors = {};
  for (const [field, required, pattern, format] of FIELDS) {
    const value = trimmed(values[field]);
    if (!value) errors[field] = required;
    else if (pattern && !pattern.test(value)) errors[field] = format;
  }
  const note = typeof values.note === 'string' ? values.note : '';
  if (note.length > maxNoteLength) errors.note = `Note must be ${maxNoteLength} characters or fewer`;
  return { valid: Object.keys(errors).length === 0, errors };
}

function firstError({ errors }) {
  const [key] = Object.keys(errors);
  return key === undefined ? null : errors[key];
}

module.exports = { validateBooking, firstError };
