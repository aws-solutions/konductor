function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function summarize(rows, numericKeys) {
  return numericKeys.reduce((result, key) => ({ ...result, [key]: sum(rows, key) }), {});
}

module.exports = { sum, summarize };
