import { appendFile } from 'node:fs/promises';
import { centsToNumber } from '../catalog/price.js';

const output = 'data/product-events.ndjson';

export function buildProductChanged(product) {
  return {
    type: 'product.changed',
    version: 1,
    occurredAt: new Date().toISOString(),
    product: {
      id: product.id,
      name: product.name,
      status: product.status,
      priceCents: centsToNumber(product.priceCents).toFixed(2),
      labels: product.labels
    }
  };
}

export async function publishProductChanged(product) {
  const event = buildProductChanged(product);
  await appendFile(output, `${JSON.stringify(event)}\n`);
  return event;
}

export function eventPrice(product) {
  return centsToNumber(product.priceCents);
}
