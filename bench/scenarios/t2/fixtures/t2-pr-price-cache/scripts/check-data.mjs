import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const names = ['tenants.json', 'northwind-products.json', 'southridge-products.json', 'northwind-retail-prices.json', 'southridge-retail-prices.json'];
for (const name of names) {
  const value = JSON.parse(await fs.readFile(path.join(root, 'data', name), 'utf8'));
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} is empty`);
}
console.log(`checked ${names.length} data files`);
