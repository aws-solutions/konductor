#!/usr/bin/env node
'use strict';

const { up, down } = require('../src/migrate');

const [cmd, ...rest] = process.argv.slice(2);
const dirAt = rest.indexOf('--dir');
const dir = dirAt >= 0 ? rest[dirAt + 1] : null;

if (!['up', 'down'].includes(cmd) || !dir) {
  console.error('usage: migrate <up|down> --dir DIR [--dry-run] [--force]');
  process.exit(2);
}

try {
  const result = cmd === 'up' ? up(dir) : down(dir);
  console.log(JSON.stringify(result));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
