'use strict';

// One-off migration: merges customers that share an email (trimmed, lower-cased).
// The record with the latest updatedAt survives and its empty fields are filled from the others, newest first.
// Merged-away records are appended unchanged to customers.archive.json; their orders move to the survivor.
const path = require('node:path');
const { readJson, writeJson } = require('../src/store');
const { normalizeEmail } = require('../src/normalize');

const isEmpty = (v) => v === undefined || v === null || v === '';
const byNewest = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt));

function dedupeCustomers(dataDir) {
  const customersFile = path.join(dataDir, 'customers.json');
  const ordersFile = path.join(dataDir, 'orders.json');
  const archiveFile = path.join(dataDir, 'customers.archive.json');
  const customers = readJson(customersFile, []);

  const groups = new Map();
  for (const c of customers) {
    const key = normalizeEmail(c.email);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const merged = new Map();
  const archived = [];
  const survivorOf = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...rest] = [...group].sort(byNewest);
    const record = { ...survivor };
    for (const other of rest) {
      for (const [field, value] of Object.entries(other)) {
        if (isEmpty(record[field]) && !isEmpty(value)) record[field] = value;
      }
      survivorOf.set(other.id, survivor.id);
    }
    merged.set(survivor.id, record);
    archived.push(...rest);
  }
  if (!archived.length) return { merged: 0 };

  const archivedIds = new Set(archived.map((c) => c.id));
  writeJson(archiveFile, [...readJson(archiveFile, []), ...customers.filter((c) => archivedIds.has(c.id))]);
  writeJson(customersFile, customers.filter((c) => !archivedIds.has(c.id)).map((c) => merged.get(c.id) ?? c));
  const orders = readJson(ordersFile, null);
  if (orders) writeJson(ordersFile, orders.map((o) => (survivorOf.has(o.customerId) ? { ...o, customerId: survivorOf.get(o.customerId) } : o)));
  return { merged: archived.length };
}

module.exports = { dedupeCustomers };

if (require.main === module) {
  const dataDir = process.argv[2] || path.join(__dirname, '..', 'data');
  const { merged } = dedupeCustomers(dataDir);
  console.log(`merged ${merged} duplicate customer(s) in ${dataDir}`);
}
