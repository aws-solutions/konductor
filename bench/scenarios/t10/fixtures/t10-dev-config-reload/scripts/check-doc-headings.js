import fs from 'node:fs';
const text = fs.readFileSync('README.md', 'utf8');
if (!text.startsWith('# Harbor Hand Worker')) throw new Error('missing title');
