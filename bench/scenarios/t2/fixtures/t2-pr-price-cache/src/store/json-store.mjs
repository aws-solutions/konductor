import fs from 'node:fs/promises';
import path from 'node:path';
import { FileLock } from './file-lock.mjs';

export class JsonStore {
  #locks = new Map();
  constructor(directory) { this.directory = directory; }
  async read(file) {
    return JSON.parse(await fs.readFile(path.join(this.directory, file), 'utf8'));
  }
  async write(file, value) {
    const lock = this.#locks.get(file) ?? new FileLock();
    this.#locks.set(file, lock);
    await lock.run(async () => {
      const target = path.join(this.directory, file);
      const temporary = `${target}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
      await fs.rename(temporary, target);
    });
  }
}
