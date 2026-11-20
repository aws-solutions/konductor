#!/bin/sh
set -eu

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const callerDirs = ['apps/dispatch', 'apps/warehouse', 'apps/billing', 'jobs', 'lib'];
const callers = callerDirs.flatMap((dir) => fs.readdirSync(path.join(root, dir))
  .filter((file) => file.endsWith('.js'))
  .map((file) => path.join(dir, file)))
  .filter((file) => !['lib/conf.js', 'lib/config.js', 'lib/index.js'].includes(file));

for (const relative of callers) {
  const file = path.join(root, relative);
  let source = fs.readFileSync(file, 'utf8');
  const importMatch = source.match(/^const .*?require\('([^']+)'\).*;$/m);
  if (!importMatch) throw new Error(`missing settings import in ${relative}`);
  const oldPath = importMatch[1];
  const newPath = oldPath.endsWith('/conf')
    ? oldPath.slice(0, -5) + '/config'
    : oldPath === './index'
      ? './config'
      : oldPath + '/config';
  source = source.replace(importMatch[0], `const config = require('${newPath}');`);

  const call = source.match(/(?:conf\.read|readSetting|read)\(([^,]+),\s*([^\n]+?)\);/);
  if (!call) throw new Error(`missing settings call in ${relative}`);
  const fallback = call[2].trim();
  let replacement;
  if (relative === 'jobs/eu-queue.js') {
    replacement = `config.value('queues', \`${'${region}'}.url\`, { fallback: ${fallback} })`;
  } else if (relative === 'jobs/us-queue.js') {
    replacement = `config.value('queues', region + '.url', { fallback: ${fallback} })`;
  } else {
    const rawKey = call[1].trim();
    const key = JSON.parse(rawKey);
    const split = key.indexOf('.');
    if (split < 1) throw new Error(`invalid dotted key in ${relative}`);
    replacement = `config.value(${JSON.stringify(key.slice(0, split))}, ${JSON.stringify(key.slice(split + 1))}, { fallback: ${fallback} })`;
  }
  source = source.replace(call[0], replacement + ';');
  fs.writeFileSync(file, source);
}

fs.writeFileSync(path.join(root, 'lib/index.js'), `'use strict';

const { value } = require('./config');

module.exports = {
  value,
  serviceTag(name) {
    return 'harborline:' + name;
  }
};
`);

fs.writeFileSync(path.join(root, 'README.md'), `# Harborline back office

Harborline coordinates dock appointments, warehouse handoffs, and carrier billing.
The service reads settings with \`config.value('section', 'key', { fallback })\` from \`lib/config.js\`.
Configuration lives in \`config/app.json\`; operators edit that file during a release window.

The three application areas share small CommonJS modules. A module returns the settings it needs and a derived value used by its caller. Keep the returned object plain so the nightly reconciliation job can serialize it.

Useful commands:

- \`npm test\` runs the local checks.
- \`node bin/report-health.js\` prints a short status line.
`);

fs.writeFileSync(path.join(root, 'docs/config.md'), `# Configuration notes

Settings are kept in \`config/app.json\` and are grouped by the service area that owns them. The current \`config.value('section', 'key', { fallback })\` reader takes a section, a key, and fallback options.

Use a short-lived branch for an operational setting change. Check the dispatch timeout and warehouse scan endpoint together because the two systems share the same appointment window.

The queue URLs are selected by region. Billing uses a separate currency and invoice prefix so a warehouse-only change does not alter customer documents.
`);

fs.unlinkSync(path.join(root, 'lib/conf.js'));
NODE
