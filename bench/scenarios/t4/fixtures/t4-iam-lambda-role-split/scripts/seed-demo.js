'use strict';
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const destination = join(process.cwd(), '.tmp', 'seed.json');
function seed() { writeFileSync(destination, JSON.stringify({ seeded: true, account: '111122223333' })); return destination; }
if (require.main === module) console.log(seed());
module.exports = { seed };
