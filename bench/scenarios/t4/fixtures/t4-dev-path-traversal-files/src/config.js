'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadConfig(file = path.join(__dirname, '..', 'config', 'default.json')) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    ...parsed,
    port: Number(process.env.PAPER_LANTERN_PORT || parsed.port),
    storageRoot: process.env.PAPER_LANTERN_ROOT || parsed.storageRoot
  };
}

module.exports = { loadConfig };
