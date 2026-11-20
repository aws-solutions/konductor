#!/bin/sh
set -eu

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();

function filesUnder(directory) {
  return fs.readdirSync(path.join(root, directory)).filter((name) => name.endsWith('.js'))
    .map((name) => path.join(directory, name));
}

const files = [...filesUnder('lib'), ...filesUnder('jobs'), ...filesUnder('apps/billing'),
  ...filesUnder('apps/warehouse'), ...filesUnder('apps/dispatch')]
  .filter((name) => !name.endsWith('/conf.js') && !name.endsWith('/config.js') && !name.endsWith('/index.js'));

for (const relative of files) {
  const file = path.join(root, relative);
  let text = fs.readFileSync(file, 'utf8');
  const oldImport = text.match(/^const .*?require\('([^']+)'\).*$/m);
  if (!oldImport) throw new Error(`settings import not found: ${relative}`);
  const oldTarget = oldImport[1];
  let target;
  if (oldTarget.endsWith('/conf')) target = `${oldTarget.slice(0, -5)}/config`;
  else if (oldTarget === './index') target = './config';
  else target = `${oldTarget}/config`;
  text = text.replace(oldImport[0], `const config = require('${target}');`);

  const readerCall = text.match(/(?:conf\.read|readSetting|read)\(([^,]+),\s*([^\n]+?)\);/);
  if (!readerCall) throw new Error(`settings call not found: ${relative}`);
  const fallback = readerCall[2].trim();
  let expression;
  if (relative === 'jobs/eu-queue.js') {
    expression = `config.value('queues', \`${'${region}'}.url\`, { fallback: ${fallback} });`;
  } else if (relative === 'jobs/us-queue.js') {
    expression = `config.value('queues', region + '.url', { fallback: ${fallback} });`;
  } else {
    const dotted = JSON.parse(readerCall[1].trim());
    const dot = dotted.indexOf('.');
    expression = `config.value(${JSON.stringify(dotted.slice(0, dot))}, ${JSON.stringify(dotted.slice(dot + 1))}, { fallback: ${fallback} });`;
  }
  text = text.replace(readerCall[0], expression);
  fs.writeFileSync(file, text);
}

fs.writeFileSync(path.join(root, 'lib/index.js'), `'use strict';

const { value } = require('./config');

module.exports = {
  serviceTag(name) {
    return 'harborline:' + name;
  },
  value
};
`);

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
fs.writeFileSync(path.join(root, 'README.md'), readme.replace(
  "The service currently reads settings with the legacy `conf.read('section.key', fallback)` helper.",
  "The service reads settings through `config.value('section', 'key', { fallback })` in `lib/config.js`."
));
const configNotes = fs.readFileSync(path.join(root, 'docs/config.md'), 'utf8');
fs.writeFileSync(path.join(root, 'docs/config.md'), configNotes.replace(
  'The old `conf.read` reader accepts a dotted setting name and a fallback value.',
  "The current `config.value('section', 'key', { fallback })` reader accepts a section, a dotted key, and fallback options."
));
fs.unlinkSync(path.join(root, 'lib/conf.js'));
NODE
