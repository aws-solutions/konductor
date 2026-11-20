'use strict';

// Shallow fake: splits on commas, stops nothing, ignores the limit and duplicates.
function importContacts(csvText, book) {
  const [head, ...lines] = String(csvText).trim().split('\n');
  const cols = head.split(',');
  let imported = 0;
  const skipped = [];
  lines.forEach((l, i) => {
    const f = l.split(',');
    try {
      book.add({ name: f[cols.indexOf('name')], email: f[cols.indexOf('email')] });
      imported++;
    } catch (e) {
      skipped.push({ line: i + 1, reason: e.message });
    }
  });
  return { imported, skipped };
}

module.exports = { importContacts };
