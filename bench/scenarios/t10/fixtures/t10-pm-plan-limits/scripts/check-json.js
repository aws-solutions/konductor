#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const roots = ['config', 'ops'];
for (const root of roots) {
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.json')) continue;
    JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  }
}
console.log('json metadata ok');
