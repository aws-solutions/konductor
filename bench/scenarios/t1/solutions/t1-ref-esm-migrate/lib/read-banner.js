import { readFileSync } from 'node:fs';

export function readBanner() {
  return readFileSync(new URL('./banner.txt', import.meta.url), 'utf8');
}
