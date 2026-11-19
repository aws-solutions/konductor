#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const names = fs.readdirSync(path.join(root, 'rules')).filter((name) => name.endsWith('.json')).sort();
for (const name of names) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'rules', name), 'utf8'));
  const expected = `${doc.service}.json`;
  if (name !== expected) process.exitCode = 1;
}
if (process.exitCode) console.error('rule filename drift detected');
else console.log(`checked ${names.length} rule filenames`);
