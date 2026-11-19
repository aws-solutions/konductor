'use strict';

const fs = require('node:fs');
const path = require('node:path');

const required = [
  path.join('docs', 'design.md'),
  path.join('docs', 'api.md'),
  path.join('docs', 'glossary.md'),
  path.join('docs', 'architecture.txt')
];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}
console.log(`checked ${required.length} design files`);
