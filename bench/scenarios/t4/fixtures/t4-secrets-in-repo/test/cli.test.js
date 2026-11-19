const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, usage } = require('../src/cli');

test('cli parses send arguments', () => {
  assert.deepEqual(parseArgs(['--to', '555-0100', '--body', 'hello']), { to: '+5550100', body: 'hello' });
  assert.match(usage(), /paper-lantern/);
});
