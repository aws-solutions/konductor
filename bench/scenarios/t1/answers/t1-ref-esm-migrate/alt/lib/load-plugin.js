import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadPlugin(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Unknown plugin: ${name}`);
  }
  const file = join(__dirname, '..', 'plugins', `${name}.js`);
  if (!existsSync(file)) {
    throw new Error(`Unknown plugin: ${name}`);
  }
  const module = await import(file);
  return module.default;
}
