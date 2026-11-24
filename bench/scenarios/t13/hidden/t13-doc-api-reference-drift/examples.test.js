'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const sourceFiles = ['README.md', 'docs/api.md'];
const fence = /^```js[ \t]*\n([\s\S]*?)^```[ \t]*$/gim;
const examples = [];
for (const file of sourceFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(fence)) examples.push({ file, code: match[1] });
}

test('the documentation contains at least four JavaScript examples', () => {
  assert.ok(examples.length >= 4, `found ${examples.length}`);
});

for (const [index, example] of examples.entries()) {
  test(`example ${index + 1} from ${example.file} runs as written`, () => {
    const name = `.doc-example-${process.pid}-${index}-${Date.now()}.js`;
    const file = path.join(root, name);
    try {
      fs.writeFileSync(file, example.code, 'utf8');
      const result = spawnSync(process.execPath, [file], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        killSignal: 'SIGKILL',
      });
      assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
}

test('examplesChecked matches the number of JavaScript examples in the docs', () => {
  const api = fs.readFileSync(path.join(root, 'docs/api.md'), 'utf8');
  const start = api.lastIndexOf('```json');
  const block = JSON.parse(api.slice(start + 7).split('```')[0]);
  assert.equal(block.examplesChecked, examples.length);
});
