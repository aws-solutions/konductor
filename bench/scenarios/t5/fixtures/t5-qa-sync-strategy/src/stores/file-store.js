const fs = require('node:fs/promises');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(require('node:path').dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

module.exports = { readJson, writeJson };
