'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function readRuleFile(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'rules', name), 'utf8'));
}

test('all checked-in rule files pass the validator', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'src/validate-rules.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('each service document declares an owner', () => {
  for (const name of fs.readdirSync(path.join(root, 'rules')).filter((entry) => entry.endsWith('.json'))) {
    assert.ok(readRuleFile(name).owner);
  }
});

test('the checkout file keeps unique rule names', () => {
  const names = readRuleFile('checkout-api.json').rules.map((rule) => rule.name);
  assert.equal(new Set(names).size, names.length);
});
