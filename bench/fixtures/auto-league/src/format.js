'use strict';

const pad = (value, width) => String(value).padEnd(width);

// Rows of equal length arrays to aligned text lines.
function formatTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  return all.map((r) => r.map((cell, i) => pad(cell, widths[i])).join('  ').trimEnd()).join('\n');
}

module.exports = { formatTable };
