import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const files = fs.readdirSync(root).filter((entry) => !entry.startsWith('.'));
const output = { generatedAt: new Date().toISOString(), entries: files.sort() };
fs.writeFileSync(path.join(root.pathname, 'manifest.json'), `${JSON.stringify(output, null, 2)}\n`);
