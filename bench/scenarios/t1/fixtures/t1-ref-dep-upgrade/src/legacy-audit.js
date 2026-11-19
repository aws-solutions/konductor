// Retained for operators who still compare last year's hand-built exports.
function findBlankRegions(rows) {
  return rows.filter((row) => !String(row.region || '').trim());
}

module.exports = { findBlankRegions };
