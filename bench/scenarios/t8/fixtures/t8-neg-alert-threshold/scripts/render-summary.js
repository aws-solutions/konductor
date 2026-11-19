#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const summary = fs.readdirSync(path.join(root, 'rules')).filter((name) => name.endsWith('.json')).sort().map((name) => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'rules', name), 'utf8'));
  return { service: doc.service, rules: doc.rules.length };
});
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
