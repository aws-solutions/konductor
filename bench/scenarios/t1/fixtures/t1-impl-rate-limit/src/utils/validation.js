const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateBooking(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'A JSON object is required';
  for (const field of ['room', 'date', 'owner']) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') return `${field} is required`;
  }
  if (!DATE_RE.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) return 'date must use YYYY-MM-DD';
  return null;
}

module.exports = { validateBooking };
