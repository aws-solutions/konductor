'use strict';

const fs = require('node:fs');

const parts = ['src/parse.js', 'src/format.js'].map((f) => fs.readFileSync(f, 'utf8'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/tinydates.js', `// GENERATED FILE. Do not edit. Run npm run release.\n${parts.join('\n')}`);
