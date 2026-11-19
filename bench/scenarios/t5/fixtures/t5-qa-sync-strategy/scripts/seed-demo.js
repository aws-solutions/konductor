const fs = require('node:fs');
const rows = JSON.parse(fs.readFileSync('fixtures/customers.json', 'utf8'));
fs.mkdirSync('.runtime', { recursive: true });
fs.writeFileSync('.runtime/demo.json', JSON.stringify(rows, null, 2));
console.log(`seeded ${rows.length} customers`);
