function columnsFor(rows, columns) {
  if (columns) return columns;
  return Object.keys(rows[0] || {}).map((key) => ({ key, label: key }));
}

function valueFor(value, numberStyle = 'plain') {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number') return String(value);
  if (numberStyle === 'grouped') {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

module.exports = { columnsFor, valueFor };
