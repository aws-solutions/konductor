import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'config', name), 'utf8'));

export function loadConfig(env = process.env) {
  const warehouses = readJson('warehouses.json').warehouses;
  const limits = readJson('limits.json');
  return {
    port: Number(env.PORT || 3400),
    warehouses,
    limits,
    flags: readJson('feature-flags.json'),
  };
}

export function warehouseById(config, id) {
  return config.warehouses.find((warehouse) => warehouse.id === id);
}
