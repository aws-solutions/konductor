'use strict';

/** `listByCategory(category)`: the snapshot items of that category in snapshot order, from an index built once. */
function createSearch(items) {
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }
  return { listByCategory: (category) => [...(byCategory.get(category) || [])] };
}

module.exports = { createSearch };
