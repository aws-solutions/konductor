const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('report command prints a count', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'timesheet.js'), 'report'], { encoding: 'utf8' });
  assert.match(output, /"entries":2/);
});
