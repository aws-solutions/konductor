'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
function block() {
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const matches = [...text.matchAll(/^```json\s*\n([\s\S]*?)^```/gim)];
  assert.ok(matches.length, 'AGENTS.md has no JSON block');
  return JSON.parse(matches.at(-1)[1]);
}
function targets() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const make = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
  return { scripts: new Set(Object.keys(pkg.scripts || {})), make: new Set([...make.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1])) };
}
test('documented commands name real scripts and targets', () => {
  const data = block();
  const { scripts, make } = targets();
  assert.ok(Array.isArray(data.commands) && data.commands.length >= 5);
  for (const item of data.commands) {
    assert.equal(typeof item.command, 'string');
    const pnpm = /^pnpm\s+([\w:-]+)/.exec(item.command);
    const npm = /^npm\s+run\s+([\w:-]+)/.exec(item.command);
    const mk = /^make\s+([\w-]+)/.exec(item.command);
    if (pnpm) assert.ok(scripts.has(pnpm[1]), `unknown pnpm script ${pnpm[1]}`);
    if (npm) assert.ok(scripts.has(npm[1]), `unknown npm script ${npm[1]}`);
    if (mk) assert.ok(make.has(mk[1]), `unknown make target ${mk[1]}`);
  }
  const text = JSON.stringify(data.commands);
  assert.doesNotMatch(text, /test:unit|legacy-migrate/i);
});

test('every non-user source is a real path:line into this repository', () => {
  const data = block();
  assert.ok(Array.isArray(data.conventions) && data.conventions.length >= 5);
  for (const c of data.conventions) {
    if (c.source === 'user') continue;
    const m = /^([^:]+):(\d+)$/.exec(String(c.source));
    assert.ok(m, `source ${c.source} is not path:line or user`);
    const file = path.join(root, m[1]);
    assert.ok(fs.existsSync(file), `${m[1]} does not exist`);
    // A pattern rule ("branches use <user>/<topic>") is backed by an example line, so only the line's existence is checked here.
    const line = fs.readFileSync(file, 'utf8').split('\n')[Number(m[2]) - 1];
    assert.ok(line !== undefined && line.trim() !== '', `${c.source} points past the end of the file or at a blank line`);
  }
});
