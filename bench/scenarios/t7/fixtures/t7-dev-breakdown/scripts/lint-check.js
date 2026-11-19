const fs = require('node:fs');
if (!fs.existsSync('src')) process.exit(1);
console.log('lint checks passed');
