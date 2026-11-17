'use strict';

/** `listByCategory(category)`: the snapshot items of that category, in snapshot order. */
function createSearch(items) {
  function listByCategory(category) {
    return items.filter((r) => r.CAT_CD === category)
      .map((r) => ({ sku: r.ITM_NO, name: r.DESC_TXT, priceCents: Number(r.PRC_CENTS), active: r.STAT === 'A', category: r.CAT_CD }));
  }
  return { listByCategory };
}

module.exports = { createSearch };
