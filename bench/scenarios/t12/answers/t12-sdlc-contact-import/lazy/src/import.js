'use strict';

// Half-done answer (hand-written): header in any order, skips bad rows and contacts already in the book with file
// lines; no BOM, no quoted fields, no duplicates within the file, no row limit.
function importContacts(csvText, book) {
  const lines = String(csvText).split(/\r?\n/);
  const cols = lines[0].split(',').map((c) => c.trim().toLowerCase());
  let imported = 0;
  const skipped = [];
  lines.slice(1).forEach((l, i) => {
    if (!l.trim()) return;
    const f = l.split(',');
    const name = (f[cols.indexOf('name')] || '').trim();
    const email = (f[cols.indexOf('email')] || '').trim();
    if (book.has(email)) { skipped.push({ line: i + 2, reason: 'duplicate' }); return; }
    try {
      book.add({ name, email, phone: cols.includes('phone') ? f[cols.indexOf('phone')] : '' });
      imported++;
    } catch (e) {
      skipped.push({ line: i + 2, reason: e.message });
    }
  });
  return { imported, skipped };
}

module.exports = { importContacts };
