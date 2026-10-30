// SPDX-License-Identifier: Apache-2.0
'use strict';

// Frontmatter reading: folded and literal block scalars must not read as one byte, and plain scalars read as before.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { frontmatter, fmValue, fmInfo } = require('../lib/frontmatter.js');
const { startupOpencode } = require('../lib/skills.js');

const fm = (body) => frontmatter(`---\n${body}\n---\n\n# Body\n`);

test('a plain single-line scalar reads exactly as before, quotes included', () => {
  const f = fm('name: alpha\ndescription: Use when testing things.\nversion: 1.4.0');
  assert.equal(fmValue(f, 'description'), 'Use when testing things.');
  assert.equal(fmValue(f, 'name'), 'alpha');
  assert.equal(fmValue(fm('description: "quoted: value"'), 'description'), '"quoted: value"');
  assert.equal(fmValue(f, 'missing'), '');
});

test('a folded scalar joins its lines with spaces instead of reading as ">"', () => {
  const f = fm('name: a\ndescription: >\n  First line of text\n  second line here.\n\n  New paragraph.\norigin: x');
  assert.equal(fmValue(f, 'description'), 'First line of text second line here.\nNew paragraph.');
  assert.equal(fmValue(f, 'origin'), 'x');
});

test('folded and literal indicators with chomping marks are read, and the next key ends the block', () => {
  assert.equal(fmValue(fm('description: >-\n  one\n  two\nname: n'), 'description'), 'one two');
  assert.equal(fmValue(fm('description: >+\n  one\n  two\n\nname: n'), 'description'), 'one two');
  assert.equal(fmValue(fm('description: |\n  line one\n    indented\n  line three\nname: n'), 'description'), 'line one\n  indented\nline three');
  assert.equal(fmValue(fm('description: |-\n  a\n  b'), 'description'), 'a\nb');
});

test('fmInfo reports the style so the audit can flag block scalars', () => {
  assert.deepEqual(fmInfo(fm('description: >\n  x y'), 'description'), { value: 'x y', style: 'folded', present: true });
  assert.equal(fmInfo(fm('description: |\n  x y'), 'description').style, 'literal');
  assert.equal(fmInfo(fm('description: plain'), 'description').style, 'plain');
  assert.equal(fmInfo(fm('description: "q"'), 'description').style, 'quoted');
  assert.deepEqual(fmInfo(fm('name: a'), 'description'), { value: '', style: 'missing', present: false });
  assert.equal(fmInfo(fm('description:'), 'description').style, 'empty');
});

test('a block scalar with an empty body is empty, not the indicator', () => {
  assert.equal(fmValue(fm('description: >\nname: n'), 'description'), '');
});

test('a key that only looks like the one asked for is not matched', () => {
  assert.equal(fmValue(fm('xdescription: no\ndescription: yes'), 'description'), 'yes');
});

test('startupOpencode sizes a folded description by its text, not one byte', () => {
  const cfg = tmp();
  try {
    write(path.join(cfg, 'agents/konductor.md'), '---\nmode: primary\n---\nhi\n');
    write(path.join(cfg, 'skills/s1/SKILL.md'), '---\nname: s1\ndescription: >\n  Twelve chars\n  and more.\n---\nbody\n');
    const st = startupOpencode(cfg);
    const idx = st.resources.find((r) => r.kind === 'skill-index');
    assert.equal(idx.bytes, Buffer.byteLength('s1') + Buffer.byteLength('Twelve chars and more.'));
  } finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});
