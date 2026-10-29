'use strict';

// Writes a tiny demo data set. It overwrites customers.json and orders.json.
const path = require('node:path');
const { writeJson } = require('../src/store');

const dataDir = process.argv[2] || path.join(__dirname, '..', 'data');

writeJson(path.join(dataDir, 'customers.json'), [
  { id: 'd1', name: 'Demo One', email: 'one@example.com', phone: '', tier: 'basic', notes: '', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
]);
writeJson(path.join(dataDir, 'orders.json'), [{ id: 'do1', customerId: 'd1', totalCents: 100 }]);
console.log(`demo data written to ${dataDir}`);
