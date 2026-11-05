'use strict';

const pad = (n, width) => String(n).padStart(width, '0');

function format({ year, month, day }) {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

exports.format = format;
