'use strict';

// The hidden "extend it" step. Adding the next format (xml, per docs/FORMATS.md) means editing every existing source
// file that lists the formats by name, so the number of such files is the edit count of that step. A file lists the
// formats when its code (comments left out) names every format listFormats() returns as a string or a key.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['src', 'bin', 'lib'];

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(c|m)?js$/.test(e.name) ? [full] : [];
  });
}

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const namesFormat = (code, name) => new RegExp(`['"\`]${name}['"\`]|(?:^|[{,\\s])${name}\\s*:`, 'm').test(code);

/** Existing source files that name every format: each must be edited to add one more. */
function filesListingEveryFormat(formats) {
  const files = SOURCE_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));
  return files.filter((f) => {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    return formats.every((name) => namesFormat(code, name));
  }).map((f) => path.relative(ROOT, f));
}

function formats() {
  const lib = require('../src');
  assert.equal(typeof lib.listFormats, 'function', 'listFormats is exported');
  const names = [...lib.listFormats()];
  assert.ok(names.includes('tsv') && names.length >= 3, 'tsv is a format');
  return names;
}

test('adding the next format edits at most 2 existing source files', () => {
  const hits = filesListingEveryFormat(formats());
  assert.ok(hits.length <= 2, `${hits.length} files list every format: ${hits.join(', ')}`);
});

test('adding the next format edits at most 1 existing source file', () => {
  const hits = filesListingEveryFormat(formats());
  assert.ok(hits.length <= 1, `${hits.length} files list every format: ${hits.join(', ')}`);
});
