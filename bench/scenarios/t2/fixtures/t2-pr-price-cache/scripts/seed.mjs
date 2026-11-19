import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
await fs.access(path.join(root, 'data', 'tenants.json'));
console.log('sample data is already present');
