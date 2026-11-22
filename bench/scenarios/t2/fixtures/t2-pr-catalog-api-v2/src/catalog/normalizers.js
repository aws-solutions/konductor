const statuses = new Set(['active', 'draft']);

export function normalizeStoredProduct(input) {
  if (!input || typeof input !== 'object') throw new Error('product must be an object');
  if (typeof input.id !== 'string' || input.id.length === 0) throw new Error('id is required');
  if (typeof input.name !== 'string' || input.name.length === 0) throw new Error('name is required');
  if (!statuses.has(input.status)) throw new Error(`unknown status: ${input.status}`);
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new Error('priceCents is invalid');

  return {
    id: input.id,
    name: input.name,
    subtitle: input.subtitle ?? '',
    status: input.status,
    priceCents: input.priceCents,
    labels: Array.isArray(input.labels) ? [...input.labels] : [],
    attributes: input.attributes && typeof input.attributes === 'object' ? { ...input.attributes } : {},
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    warehouseNote: input.warehouseNote ?? ''
  };
}

export function normalizeCreateBody(body) {
  const product = normalizeStoredProduct({
    ...body,
    id: body.id ?? `p-${Date.now()}`,
    status: body.status ?? 'draft',
    priceCents: numberToCents(body.price)
  });
  return product;
}

function numberToCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isInteger(cents) || cents < 0) throw new Error('price is invalid');
  return cents;
}
