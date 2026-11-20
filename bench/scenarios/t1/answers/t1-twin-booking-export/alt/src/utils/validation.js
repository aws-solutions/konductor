const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isStrictISODate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function validateBooking(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'A JSON object is required';
  for (const field of ['room', 'date', 'owner']) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') return `${field} is required`;
  }
  if (!DATE_RE.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) return 'date must use YYYY-MM-DD';
  return null;
}

module.exports = { validateBooking, isStrictISODate };
