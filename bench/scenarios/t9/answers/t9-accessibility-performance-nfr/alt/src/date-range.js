import { parseDate } from './dates.js';

const FORMAT_HINT = 'Use 2025-03-14 or 14/03/2025.';

// Looks at the two boxes and lists what is wrong: [{ field: 'from' | 'to', text }].
export function rangeProblems(fromText, toText) {
  const problems = [];
  const stamps = {};
  for (const [field, raw, name] of [['from', fromText, 'From'], ['to', toText, 'To']]) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    stamps[field] = parseDate(trimmed);
    if (stamps[field] === null) problems.push({ field, text: `${name} is not a date that exists. ${FORMAT_HINT}` });
  }
  if (typeof stamps.from === 'number' && typeof stamps.to === 'number' && stamps.to < stamps.from) {
    problems.push({ field: 'to', text: 'To comes before From, so no order can fall inside. Move To later or From earlier.' });
  }
  return problems;
}
