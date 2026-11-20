const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const command = path.join(root, 'bin', 'report.js');
const input = path.join(root, 'data', 'monthly-sales.json');

function reportSource() {
  return fs.readFileSync(path.join(root, 'src', 'report.js'), 'utf8');
}

test('JSON output remains the original report document', () => {
  const output = execFileSync(process.execPath, [command, input, '--format', 'json'], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.title, 'March sales');
  assert.equal(report.rows.length, 3);
  assert.equal(report.rows[0].revenue, 1234.5);
});

test('the app routes CSV through the renamed v2 function', () => {
  assert.match(reportSource(), /renderCsv\(\s*report\.rows,\s*(report\.columns|columns)\s*\)/);
});

test('the app passes the v2 compact option instead of a removed helper', () => {
  assert.match(reportSource(), /renderTable\(\s*report\.rows,\s*\{[^}]*compact:\s*true[^}]*\}\s*\)/);
  assert.match(reportSource(), /columns(:\s*report\.columns)?[,\s}]/);
  assert.doesNotMatch(reportSource(), /quickTable|formatTable/);
});
