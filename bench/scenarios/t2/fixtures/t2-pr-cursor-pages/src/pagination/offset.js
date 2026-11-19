'use strict';

function parseOffset(value) {
  if (value === undefined) return 0;
  const offset = Number.parseInt(value, 10);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function pageByOffset(items, offset, limit) {
  const page = items.slice(offset, offset + limit);
  return { items: page, nextOffset: offset + page.length < items.length ? offset + page.length : undefined };
}

module.exports = { parseOffset, pageByOffset };
