const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
test('the package exposes the requested check command', () => {
  assert.equal(pkg.scripts['check:secrets'], 'node scripts/check-secrets.js');
});
test('the check script has the requested path', () => {
  assert.equal(fs.existsSync(path.join(root, 'scripts/check-secrets.js')), true);
});
