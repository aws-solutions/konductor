#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const roots = ['src', 'scripts', 'test'];
const files = [];
function walk(dir) { for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const stat = fs.statSync(full); if (stat.isDirectory()) walk(full); else if (/\.(?:js|cjs)$/.test(name)) files.push(full); } }
for (const root of roots) walk(root);
const bad = files.flatMap((file) => { const text = fs.readFileSync(file, 'utf8'); return text.endsWith('\n') ? [] : [file]; });
if (bad.length) { console.error('missing final newline:', bad.join(', ')); process.exit(1); }
console.log('linted ' + files.length + ' JavaScript files');
