const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function temporaryQueue() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fulfilment-'));
  return { directory, filePath: path.join(directory, 'jobs.json') };
}

async function removeTemporaryQueue(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

module.exports = { temporaryQueue, removeTemporaryQueue };
