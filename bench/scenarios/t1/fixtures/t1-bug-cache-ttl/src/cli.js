'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');
const { loadConfig } = require('./config');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8'));
}

function main() {
  const app = createApp({
    profiles: readJson('profiles.json'),
    permissions: readJson('permissions.json'),
    cacheOptions: loadConfig().cache
  });
  const profile = app.profile({ id: process.argv[2] || 'u-100' });
  process.stdout.write(JSON.stringify(profile) + '\n');
  app.close();
}

if (require.main === module) main();
module.exports = { main };
