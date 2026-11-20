const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('callers use the current reader and the public facade keeps service tags', () => {
  assert.deepEqual(require('../apps/dispatch/manifest')(), { timeout: 4500, deadline: 4800 });
  const api = require('../lib');
  assert.equal(typeof api.value, 'function');
  assert.equal(api.read, undefined);
  assert.equal(api.serviceTag('health'), 'harborline:health');
  assert.equal(fs.existsSync(path.join(root, 'lib', 'conf.js')), false);
});
