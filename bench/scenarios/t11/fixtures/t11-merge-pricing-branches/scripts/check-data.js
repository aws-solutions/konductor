'use strict';

const { findItem } = require('../src/catalog');

for (const sku of ['mug-blue', 'tea-tin', 'linen-wrap']) {
  if (!findItem(sku)) process.exitCode = 1;
}
