#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', 'logs', 'platform.log');
const destination = path.join(__dirname, '..', 'logs', 'platform.previous.log');

if (!fs.existsSync(source)) {
  console.error('platform log is not present');
  process.exitCode = 1;
} else {
  const lines = fs.readFileSync(source, 'utf8').trimEnd().split('\n');
  const keep = lines.slice(Math.max(0, lines.length - 500));
  fs.writeFileSync(destination, keep.join('\n') + '\n');
  console.log(`saved ${keep.length} lines`);
}
