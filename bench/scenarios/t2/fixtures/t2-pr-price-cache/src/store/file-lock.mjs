export class FileLock {
  #busy = false;
  async run(work) {
    while (this.#busy) await new Promise((resolve) => setTimeout(resolve, 1));
    this.#busy = true;
    try { return await work(); } finally { this.#busy = false; }
  }
}
