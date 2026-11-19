'use strict';
const { rmSync } = require('node:fs');
function clean(path) { rmSync(path, { recursive: true, force: true }); }
if (require.main === module) clean(process.argv[2] || '.tmp');
module.exports = { clean };
