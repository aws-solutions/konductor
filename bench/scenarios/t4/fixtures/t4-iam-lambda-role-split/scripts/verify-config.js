'use strict';
const { REGIONS, resources } = require('../config/stages');
for (const stage of Object.keys(REGIONS)) {
  const r = resources(stage);
  if (!r.createOrder.table.startsWith('arn:aws:dynamodb:')) throw new Error(`bad table for ${stage}`);
}
console.log(`validated ${Object.keys(REGIONS).length} stages`);
