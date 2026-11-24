#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Read-only: list the non-closed rows of bench/DEBT.md with id, area, owner, due, status, and a short symptom.
//   node debt-open-rows.js <konductor checkout>/bench/DEBT.md
'use strict';
const fs = require('fs');
const path = process.argv[2];
const lines = fs.readFileSync(path, 'utf8').split('\n');
const rows = [];
for (const l of lines) {
  if (!l.startsWith('| ')) continue;
  const c = l.split(' | ').map((x) => x.replace(/^\| /, '').replace(/ \|$/, '').trim());
  if (c.length < 10) continue;
  const [id, area, symptom, , owner, next, , due, status] = c;
  if (!/^(open|in progress|blocked)$/.test(status)) continue;
  rows.push({ id, area, owner, due, status, symptom: symptom.slice(0, 110), next: next.slice(0, 90) });
}
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log('non-closed', rows.length);
console.log('by status', by('status'));
console.log('by owner', by('owner'));
console.log('by area', by('area'));
for (const r of rows) console.log(`${r.id} | ${r.area} | ${r.owner} | ${r.due} | ${r.status} | ${r.symptom} || NEXT: ${r.next}`);
