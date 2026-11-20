function countReasons(rows) {
  return rows.reduce((counts, row) => {
    counts[row.reason] = (counts[row.reason] || 0) + Number(row.units || 0);
    return counts;
  }, {});
}

module.exports = { countReasons };
