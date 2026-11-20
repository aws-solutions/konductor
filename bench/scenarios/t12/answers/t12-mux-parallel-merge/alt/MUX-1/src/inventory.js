'use strict';

function applyMovements(catalog, movements) {
  if (!Array.isArray(catalog) || !Array.isArray(movements)) {
    throw new TypeError('Catalog and movements must be arrays');
  }

  const balances = new Map(catalog.map((item) => [item.sku, 0]));
  movements.forEach((movement, index) => {
    if (!movement || typeof movement.sku !== 'string' || !balances.has(movement.sku)) {
      throw new RangeError(`Movement ${index + 1} references an unknown SKU`);
    }
    if (!Number.isInteger(movement.quantity) || movement.quantity === 0) {
      throw new TypeError(`Movement ${index + 1} quantity must be a non-zero integer`);
    }

    const nextBalance = balances.get(movement.sku) + movement.quantity;
    if (nextBalance < 0) {
      throw new RangeError(`Movement ${index + 1} would make stock negative`);
    }
    balances.set(movement.sku, nextBalance);
  });

  return catalog.map((item) => ({
    ...item,
    onHand: balances.get(item.sku)
  }));
}

function findReorderItems(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Items must be an array');
  }

  const reorderItems = [];
  for (const item of items) {
    if (item.onHand <= item.reorderPoint) {
      reorderItems.push(item);
    }
  }
  return reorderItems;
}

module.exports = { applyMovements, findReorderItems };
