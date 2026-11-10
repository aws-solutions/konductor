'use strict';
const fs = require('fs');

// Builds the whole CSV in memory, then writes it to local disk.
async function exportOrders(repo, customerId) {
  const rows = await repo.findByCustomer(customerId);
  const csv = ['id,total,created_at']
    .concat(rows.map((r) => `${r.id},${r.total},${r.created_at}`))
    .join('\n');
  const path = `/tmp/export-${customerId}.csv`;
  fs.writeFileSync(path, csv);
  return path;
}

module.exports = { exportOrders };
