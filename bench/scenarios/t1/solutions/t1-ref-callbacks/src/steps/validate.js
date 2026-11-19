'use strict';
const fs = require('node:fs/promises');
async function validateInput(inputDir) {
  const stat = await fs.stat(inputDir);
  if (!stat.isDirectory()) throw new Error(`input is not a directory: ${inputDir}`);
}
module.exports = { validateInput };
