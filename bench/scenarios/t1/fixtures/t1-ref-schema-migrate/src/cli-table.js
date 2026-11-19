function table(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join(' | '), ...rows.map((row) => keys.map((key) => row[key] ?? '').join(' | '))].join('\n');
}
module.exports = { table };
