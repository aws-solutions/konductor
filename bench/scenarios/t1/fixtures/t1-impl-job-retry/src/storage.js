const fs = require('node:fs/promises');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(require('node:path').dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = { readJson, writeJson };
