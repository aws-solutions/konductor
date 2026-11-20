'use strict';

function parseCatalog(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Catalog must be text');
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const fields = line.split(',').map((field) => field.trim());
    if (fields.length !== 4 || !fields[0] || !fields[1]) {
      throw new TypeError(`Catalog row ${index + 1} must have four fields`);
    }

    const unitPrice = Number(fields[2]);
    const reorderPoint = Number(fields[3]);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new RangeError(`Catalog row ${index + 1} has an invalid price`);
    }
    if (!Number.isInteger(reorderPoint) || reorderPoint < 0) {
      throw new RangeError(`Catalog row ${index + 1} has an invalid reorder point`);
    }

    return {
      sku: fields[0],
      name: fields[1],
      unitPrice,
      reorderPoint
    };
  });
}

function getCatalogItem(catalog, sku) {
  return catalog.find((item) => item.sku === sku);
}

module.exports = { parseCatalog, getCatalogItem };
