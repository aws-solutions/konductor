import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the page includes the registration action', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Register/);
  assert.match(html, /type="module"/);
});
