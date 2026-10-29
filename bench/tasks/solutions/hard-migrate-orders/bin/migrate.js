#!/usr/bin/env node
'use strict';

const { up, down, CliError } = require('../src/migrate');

const [cmd, ...rest] = process.argv.slice(2);
const dirAt = rest.indexOf('--dir');
const dir = dirAt >= 0 ? rest[dirAt + 1] : null;
const flags = { dryRun: rest.includes('--dry-run'), force: rest.includes('--force') };

if (!['up', 'down'].includes(cmd) || !dir) {
  console.error('usage: migrate <up|down> --dir DIR [--dry-run] [--force]');
  process.exit(2);
}

try {
  console.log(JSON.stringify(cmd === 'up' ? up(dir, flags) : down(dir, flags)));
} catch (e) {
  console.error(e.message);
  process.exit(e instanceof CliError ? e.code : 2);
}
