const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const demo = {
  id: 'demo-1001',
  email: 'buyer@example.test',
  lines: [{ sku: 'MUG-BLUE', unitPrice: 12.5, quantity: 1 }],
  discount: 0,
  taxRate: 0.0825
};
writeFileSync(join(__dirname, '..', '.tmp-demo.json'), JSON.stringify(demo, null, 2));
process.stdout.write('demo order written\n');
