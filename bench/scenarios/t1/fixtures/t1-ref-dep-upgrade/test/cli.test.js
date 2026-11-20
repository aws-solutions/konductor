const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const command = path.join(root, 'bin', 'report.js');
const input = path.join(root, 'data', 'monthly-sales.json');

test('the CLI renders the sample title', () => {
  const output = execFileSync(process.execPath, [command, input], { encoding: 'utf8' });
  assert.match(output, /^March sales\n/);
  assert.match(output, /North/);
});

test('the CLI supports JSON output', () => {
  const output = execFileSync(process.execPath, [command, input, '--format=json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).title, 'March sales');
});
