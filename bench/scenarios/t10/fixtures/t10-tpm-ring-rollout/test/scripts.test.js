'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('config check passes', () => assert.match(execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts/check-config.js')], { encoding: 'utf8' }), /ok/));
test('csv check passes', () => assert.match(execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts/check-csv.js')], { encoding: 'utf8' }), /ok/));
test('health check reports healthy', () => assert.match(execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts/health-check.js')], { encoding: 'utf8' }), /healthy/));
test('package has test command', () => assert.equal(require('../package.json').scripts.test, 'node --test'));
test('architecture mentions renderer', () => assert.match(require('node:fs').readFileSync(path.join(__dirname, '..', 'docs/architecture.md'), 'utf8'), /renderer/));
