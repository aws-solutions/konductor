// SPDX-License-Identifier: Apache-2.0
'use strict';

// A benchmark must not send usage metrics. Every place the bench installs konductor passes --no-telemetry; this reads
// the source so a new install call cannot leave it out.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..', '..');

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'test' && e.name !== 'node_modules') sourceFiles(p, out);
    } else if (/\.(js|sh)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('every konductor install argument list in the bench source includes --no-telemetry', () => {
  const found = [];
  for (const file of sourceFiles(BENCH)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\[\s*'install'\s*,[^\]]*\]/g)) {
      if (!m[0].includes("'--harness'")) continue;
      found.push({ file: path.relative(BENCH, file), args: m[0] });
    }
  }
  assert.ok(found.length >= 3, `expected the Kiro, Claude Code and opencode install calls, found ${found.length}`);
  for (const { file, args } of found) assert.match(args, /'--no-telemetry'/, `${file}: ${args}`);
});

test('no shell script in the bench runs konductor install or update outside a comment or a check', () => {
  for (const file of sourceFiles(BENCH).filter((f) => f.endsWith('.sh'))) {
    const live = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /\bkonductor[^ ]* +(install|update)\b/.test(l) && !/^\s*#/.test(l) && !/pgrep|echo|printf|why\+=|pf /.test(l));
    assert.deepEqual(live, [], path.relative(BENCH, file));
  }
});
