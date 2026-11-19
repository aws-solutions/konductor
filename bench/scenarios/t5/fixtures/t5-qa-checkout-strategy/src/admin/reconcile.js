const fs = require('node:fs');
const path = require('node:path');

function readRows(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const parts = line.split(',');
    return { id: parts[0], amount: Number(parts[1]), status: parts[2] };
  });
}

function reconcile(local, remote) {
  const remoteById = new Map(remote.map((row) => [row.id, row]));
  const result = { matched: [], missing: [], amountMismatches: [] };
  for (const row of local) {
    const other = remoteById.get(row.id);
    if (!other) result.missing.push(row.id);
    else if (row.amount !== other.amount) result.amountMismatches.push({ id: row.id, local: row.amount, remote: other.amount });
    else result.matched.push(row.id);
  }
  return result;
}

function loadAndReconcile(localFile, remoteFile) {
  return reconcile(readRows(path.resolve(localFile)), readRows(path.resolve(remoteFile)));
}

module.exports = { readRows, reconcile, loadAndReconcile };
