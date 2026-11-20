import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log(`${pkg.name}@${pkg.version}`);
