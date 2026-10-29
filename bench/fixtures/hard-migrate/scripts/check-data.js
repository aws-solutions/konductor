'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2] || 'data';
const lines = fs.readFileSync(path.join(dir, 'orders.jsonl'), 'utf8').split('\n').filter(Boolean);
const v2 = lines.filter((l) => l.includes('"schema":2')).length;
console.log(`${lines.length} records, ${v2} in schema 2`);
