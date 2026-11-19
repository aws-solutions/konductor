import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadConfig(root, name = 'default') {
  const file = path.join(root, 'config', `${name}.json`);
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  return { ...value, dataDir: path.resolve(root, value.dataDir) };
}
