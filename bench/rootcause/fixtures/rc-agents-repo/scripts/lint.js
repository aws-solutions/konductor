'use strict';

const fs = require('node:fs');
const path = require('node:path');

const bad = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      const text = fs.readFileSync(p, 'utf8');
      if (/\t/.test(text)) bad.push(`${p}: tab character`);
      if (/export default|module\.exports\s*=/.test(text)) bad.push(`${p}: default export`);
    }
  }
}
walk('src');
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
