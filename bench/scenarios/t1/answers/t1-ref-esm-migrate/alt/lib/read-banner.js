import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function readBanner() {
  return readFileSync(join(__dirname, 'banner.txt'), 'utf8');
}
