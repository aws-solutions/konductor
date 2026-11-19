function parseDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value !== 'string') throw new TypeError('date must be a string or Date');
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new RangeError(`invalid date: ${value}`);
  return result;
}

function formatDate(value) {
  const date = parseDate(value);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(value, amount) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function daysBetween(start, end) {
  const from = parseDate(start);
  const to = parseDate(end);
  const calendarDay = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((calendarDay(to) - calendarDay(from)) / 86400000);
}

function overlaps(start, end, otherStart, otherEnd) {
  const a = parseDate(start);
  const b = parseDate(end);
  const c = parseDate(otherStart);
  const d = parseDate(otherEnd);
  return a < d && c < b;
}

function monthRange(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('month must be between 1 and 12');
  }
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1)
  };
}

module.exports = { parseDate, formatDate, addDays, daysBetween, overlaps, monthRange };
