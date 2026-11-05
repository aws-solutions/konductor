// GENERATED FILE. Do not edit. Run npm run release.
'use strict';

function parse(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim());
  if (!m) throw new Error(`not an ISO date: ${text}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

exports.parse = parse;

'use strict';

const pad = (n, width) => String(n).padStart(width, '0');

function format({ year, month, day }) {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

exports.format = format;
