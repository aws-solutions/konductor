const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const command = path.join(root, 'bin', 'report.js');
const input = path.join(root, 'data', 'monthly-sales.json');
const expectedTable = [
  'March sales',
  'Region | Orders | Revenue',
  'North | 12 | 1234.5',
  'South | 7 | 987',
  'West | 19 | 4200'
].join('\n');

test('the bundled v2 public exports are available', () => {
  const gridline = require('../vendor/gridline/v2');
  assert.equal(typeof gridline.renderTable, 'function');
  assert.equal(typeof gridline.renderCsv, 'function');
});

test('the report module selects the v2 bundle', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'report.js'), 'utf8');
  assert.match(source, /vendor\/gridline\/v2/);
  assert.doesNotMatch(source, /vendor\/gridline\/v1/);
});

test('normal table output uses v2 plain numeric defaults', () => {
  const output = execFileSync(process.execPath, [command, input, '--format', 'table'], { encoding: 'utf8' });
  assert.equal(output, expectedTable);
});

test('the default command output uses the new table renderer', () => {
  const output = execFileSync(process.execPath, [command, input], { encoding: 'utf8' });
  assert.equal(output, expectedTable);
});

test('compact output uses tabs and has no heading row', () => {
  const output = execFileSync(process.execPath, [command, input, '--compact'], { encoding: 'utf8' });
  assert.equal(output, ['North\t12\t1234.5', 'South\t7\t987', 'West\t19\t4200'].join('\n'));
  assert.doesNotMatch(output, /Region/);
});

test('the compact path does not call the removed shortcut', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'report.js'), 'utf8');
  assert.match(source, /renderTable/);
  assert.doesNotMatch(source, /quickTable/);
});

test('the renderer keeps plain numeric values beside input labels', () => {
  const output = execFileSync(process.execPath, [command, input], { encoding: 'utf8' });
  assert.match(output, /^March sales\nRegion \| Orders \| Revenue\nNorth \| 12 \| 1234\.5\n/);
});

test('the app does not load the v1 index', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'report.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.\/vendor\/gridline\/v1/);
});
