'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

test('commands provide useful summaries', () => {
  const check = spawnSync(process.execPath, ['bin/atlas.js', 'check', 'data/sample.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(check.status, 0);
  assert.equal(check.stdout, 'check: clean\n');
  const inspect = spawnSync(process.execPath, ['bin/atlas.js', 'inspect', 'data/sample.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(inspect.stdout, 'inspect: object\n');
  const report = spawnSync(process.execPath, ['bin/atlas.js', 'report', 'data/sample.json'], { cwd: root, encoding: 'utf8' });
  assert.match(report.stdout, /^Atlas report\n/);
});

test('format registration happens when formatting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-visible-'));
  try {
    const marker = path.join(dir, 'marker');
    const result = spawnSync(process.execPath, ['bin/atlas.js', 'format', 'data/notes.txt'], { cwd: root, env: { ...process.env, ATLAS_FORMAT_MARKER: marker }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'format-registration\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
