import fs from 'node:fs';
const rows = fs.readFileSync('ops/metrics.csv', 'utf8').trim().split('\n');
if (rows.length < 4 || rows[0] !== 'name,unit,meaning') throw new Error('metric catalogue is too small');
const names = rows.slice(1).map((row) => row.split(',')[0]);
if (new Set(names).size !== names.length || names.some((name) => !/^[a-z][a-z0-9_]+$/.test(name))) throw new Error('bad metric name');
console.log(`checked ${names.length} metrics`);
