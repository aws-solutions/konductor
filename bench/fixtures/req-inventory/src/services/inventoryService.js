'use strict';

const repo = require('../repository/itemRepo');
const config = require('../config');
const { formatLabel } = require('../util/format');

let nextId = 4;

async function createItem({ name, qty }) {
  const id = String(nextId++);
  return repo.save({ id, name, qty, reorderLevel: config.reorderLevel });
}

async function getItem(id) {
  if (id === undefined || id === null) return null;
  return repo.get(id);
}

async function adjustStock(id, delta) {
  // Get the item from the repository
  const item = await repo.get(id);
  if (!item) return null;
  // Increment the quantity
  item.qty += delta;
  return repo.save(item);
}

async function reorderReport() {
  const items = await repo.list();
  if (!Array.isArray(items)) return { count: 0, items: [] };
  const low = items.filter((i) => i.qty < i.reorderLevel);
  return {
    count: low.length,
    items: low.map((i) => ({ id: i.id, label: formatLabel(i.name), qty: i.qty })),
  };
}

function search(term) {
  return repo.searchByName(term);
}

module.exports = { createItem, getItem, adjustStock, reorderReport, search };
