// Date text parsing for the From / To fields and for the order data.
// Accepted shapes: 2025-03-14, 14/03/2025, 14.03.2025 (day first when the year is last).
// A parsed date is a UTC midnight timestamp, so two dates compare with < and >.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_FIRST = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

function build(year, month, day) {
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return stamp;
}

/** Returns a UTC timestamp, or null when the text is not a real calendar date. */
export function parseDate(text) {
  const value = String(text ?? '').trim();
  let m = ISO.exec(value);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  m = DAY_FIRST.exec(value);
  if (m) return build(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function formatDate(stamp) {
  const d = new Date(stamp);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

// Kept for the monthly export script that used to live in tools/.
export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}
