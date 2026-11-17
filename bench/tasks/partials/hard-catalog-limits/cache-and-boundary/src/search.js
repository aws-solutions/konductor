'use strict';

function createSearch(items) {
  return { listByCategory: (category) => items.filter((item) => item.category === category) };
}

module.exports = { createSearch };
