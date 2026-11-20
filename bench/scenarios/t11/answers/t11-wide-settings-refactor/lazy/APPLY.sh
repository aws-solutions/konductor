#!/bin/sh
set -eu

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const dirs = ['apps/dispatch', 'apps/warehouse', 'apps/billing', 'jobs', 'lib'];
for (const dir of dirs) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!name.endsWith('.js')) continue;
    const relative = path.join(dir, name);
    if (['lib/conf.js', 'lib/config.js', 'lib/index.js'].includes(relative)) continue;
    const file = path.join(root, relative);
    let source = fs.readFileSync(file, 'utf8');
    if (!source.startsWith("'use strict';\n\nconst conf = require('")) continue;
    const found = source.match(/^const conf = require\('([^']+)'\);$/m);
    const oldPath = found[1];
    const configPath = oldPath.slice(0, -5) + '/config';
    source = source.replace(found[0], `const config = require('${configPath}');`);
    const call = source.match(/conf\.read\(([^,]+),\s*([^\n]+?)\);/);
    if (!call) throw new Error(`direct call not found in ${relative}`);
    const fallback = call[2].trim();
    let replacement;
    if (relative === 'jobs/us-queue.js') {
      replacement = `config.value('queues', region + '.url', { fallback: ${fallback} });`;
    } else {
      const dotted = JSON.parse(call[1].trim());
      const dot = dotted.indexOf('.');
      replacement = `config.value(${JSON.stringify(dotted.slice(0, dot))}, ${JSON.stringify(dotted.slice(dot + 1))}, { fallback: ${fallback} });`;
    }
    fs.writeFileSync(file, source.replace(call[0], replacement));
  }
}
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
fs.writeFileSync(path.join(root, 'README.md'), readme.replace(
  "The service currently reads settings with the legacy `conf.read('section.key', fallback)` helper.",
  "The service reads settings through `config.value('section', 'key', { fallback })` in `lib/config.js`."
));
NODE
