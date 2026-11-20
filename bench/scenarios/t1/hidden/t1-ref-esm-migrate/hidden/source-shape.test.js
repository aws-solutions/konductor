import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function jsFiles(directory) {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) names.push(...await jsFiles(full));
    else if (entry.name.endsWith('.js')) names.push(full);
  }
  return names;
}

test('package JavaScript uses imports instead of CommonJS loading', async () => {
  const files = [
    'index.js', 'cli.js', 'lib/constants.js', 'lib/format.js', 'lib/normalize.js',
    'lib/load-plugin.js', 'lib/read-banner.js', 'lib/manifest.js', 'lib/cycle-a.js',
    'lib/cycle-b.js', 'lib/cycle-value.js', 'plugins/compact.js', 'plugins/verbose.js'
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\brequire\s*\(/, file);
    assert.doesNotMatch(source, /\bmodule\.exports\b/, file);
  }
});

test('the plugin loader constructs an import from a validated name', async () => {
  const source = await readFile('lib/load-plugin.js', 'utf8');
  assert.match(source, /import\s*\(/);
  assert.match(source, /compact/);
  assert.match(source, /verbose/);
});
