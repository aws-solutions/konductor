'use strict';

/** Sequential ids with a prefix: b-1, b-2, ... */
function createIdSource(prefix) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

module.exports = { createIdSource };
