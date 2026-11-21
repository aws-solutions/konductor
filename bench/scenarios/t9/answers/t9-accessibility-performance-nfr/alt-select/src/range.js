import { parseDate } from './dates.js';

// Checks the From / To text. An empty box is fine (that end stays open).
// Returns { from, to } where each is an error message or '' when it is fine.
export function validateRange(fromText, toText) {
  const result = { from: '', to: '' };
  const fromBlank = !String(fromText ?? '').trim();
  const toBlank = !String(toText ?? '').trim();
  const fromStamp = fromBlank ? null : parseDate(fromText);
  const toStamp = toBlank ? null : parseDate(toText);

  if (!fromBlank && fromStamp === null) {
    result.from = 'From is not a real date. Use 2025-03-14 or 14/03/2025.';
  }
  if (!toBlank && toStamp === null) {
    result.to = 'To is not a real date. Use 2025-03-14 or 14/03/2025.';
  }
  if (fromStamp !== null && toStamp !== null && toStamp < fromStamp) {
    result.to = 'To is earlier than From. Pick an end date on or after the start date.';
  }
  return result;
}
