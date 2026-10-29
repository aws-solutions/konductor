'use strict';

// Parses one CSV line into fields. Commas inside double quotes do not split.
function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current !== '') fields.push(current);
  return fields;
}

// Parses CSV text into an array of rows. Blank lines are skipped.
function parseCsv(text) {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map(parseLine);
}

module.exports = { parseLine, parseCsv };
