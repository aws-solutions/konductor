import fs from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve('data/products.json');

export async function listProducts() {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
}

export async function findProduct(id) {
  const products = await listProducts();
  return products.find((product) => product.id === id) ?? null;
}

export async function saveProduct(product) {
  const products = await listProducts();
  const index = products.findIndex((entry) => entry.id === product.id);
  if (index === -1) products.push(product);
  else products[index] = product;
  await fs.writeFile(file, `${JSON.stringify(products, null, 2)}\n`);
  return product;
}
