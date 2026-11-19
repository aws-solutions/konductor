"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('tenant generator writes the catalog shape to a clean directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-stamp-'));
  try {
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'tenants.json'), 'utf8'));
    const copy = path.join(temp, 'tenants.json');
    fs.writeFileSync(copy, JSON.stringify(source));
    assert.equal(source.tenants.length, 40);
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'stamp-tenants.js'), '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
