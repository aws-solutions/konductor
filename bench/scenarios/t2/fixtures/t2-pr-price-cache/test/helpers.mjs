import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tempData() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-test-'));
  return directory;
}

export async function writeJson(directory, file, value) {
  await fs.writeFile(path.join(directory, file), `${JSON.stringify(value)}\n`);
}
