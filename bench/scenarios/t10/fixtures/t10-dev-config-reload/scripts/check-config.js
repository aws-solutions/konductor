import fs from 'node:fs';
for (const name of ['config/worker.json', 'config/limits.json']) {
  const value = JSON.parse(fs.readFileSync(name, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error(`bad ${name}`);
}
console.log('checked config bundles');
