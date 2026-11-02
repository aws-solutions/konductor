// SPDX-License-Identifier: Apache-2.0
'use strict';

// Parsing a SKILL.md into sections with 1-based inclusive line ranges, code blocks and tables.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSkill, slugOf } = require('../../cap/sections.js');

const SKILL = [
  '---', // 1
  'name: demo', // 2
  'description: Use when demoing.', // 3
  '---', // 4
  '', // 5
  '# Demo', // 6
  '', // 7
  'Intro line.', // 8
  '', // 9
  '## Steps', // 10
  '', // 11
  '1. Do one.', // 12
  '2. Do two.', // 13
  '', // 14
  '### Detail', // 15
  '', // 16
  'More words.', // 17
  '', // 18
  '## Template', // 19
  '', // 20
  '```md', // 21
  '# not a heading', // 22
  '## also not a heading', // 23
  '```', // 24
  '', // 25
  '| a | b |', // 26
  '|---|---|', // 27
  '| 1 | 2 |', // 28
  '', // 29
  '## Steps', // 30
  '', // 31
  'Second steps section.', // 32
].join('\n') + '\n';

test('frontmatter, preamble and sections get 1-based inclusive line ranges', () => {
  const p = parseSkill(SKILL);
  assert.deepEqual(p.frontmatter, { startLine: 1, endLine: 4 });
  assert.equal(p.lineCount, 32);
  assert.deepEqual([p.preamble.startLine, p.preamble.endLine], [5, 9]);
  const byId = Object.fromEntries(p.sections.map((s) => [s.id, s]));
  assert.deepEqual(p.sections.map((s) => [s.id, s.level, s.startLine, s.endLine]), [
    ['demo', 1, 6, 32], ['steps', 2, 10, 18], ['detail', 3, 15, 18], ['template', 2, 19, 29], ['steps-2', 2, 30, 32],
  ]);
  assert.equal(byId.steps.parent, 'demo');
  assert.equal(byId.detail.parent, 'steps');
  assert.deepEqual(byId.steps.children, ['detail']);
});

test('headings inside fenced code blocks are not sections', () => {
  const p = parseSkill(SKILL);
  assert.equal(p.sections.some((s) => /not a heading/.test(s.title)), false);
});

test('blocks record code fences and tables with line ranges, and a kind says whether the section is reference-like', () => {
  const t = parseSkill(SKILL).sections.find((s) => s.id === 'template');
  assert.deepEqual(t.blocks.code, [{ startLine: 21, endLine: 24, lang: 'md' }]);
  assert.deepEqual(t.blocks.tables, [{ startLine: 26, endLine: 28 }]);
  assert.equal(t.kind, 'reference');
  assert.equal(parseSkill(SKILL).sections.find((s) => s.id === 'steps-2').kind, 'procedure');
});

test('bytes and tokens are measured on the section lines, children included', () => {
  const p = parseSkill(SKILL);
  const lines = SKILL.split('\n');
  const steps = p.sections.find((s) => s.id === 'steps');
  const want = Buffer.byteLength(`${lines.slice(9, 18).join('\n')}\n`);
  assert.equal(steps.bytes, want);
  assert.equal(steps.estTokens, Math.round(want / 4));
});

test('a file with no frontmatter and no headings has a preamble only', () => {
  const p = parseSkill('just text\nmore\n');
  assert.equal(p.frontmatter, null);
  assert.deepEqual(p.sections, []);
  assert.deepEqual([p.preamble.startLine, p.preamble.endLine], [1, 2]);
});

test('an unclosed fence runs to the end of the file and hides later headings', () => {
  const p = parseSkill('# T\n\n## A\n\n```\n## B\n');
  assert.deepEqual(p.sections.map((s) => s.id), ['t', 'a']);
});

test('longer fences close only on a matching fence and tilde fences work', () => {
  const p = parseSkill('# T\n\n## A\n\n````md\n```\n## inner\n```\n````\n\n~~~\n## tilde\n~~~\n\n## B\n');
  assert.deepEqual(p.sections.map((s) => s.id), ['t', 'a', 'b']);
});

test('CRLF text keeps the same line numbers', () => {
  const p = parseSkill(SKILL.replace(/\n/g, '\r\n'));
  assert.deepEqual(p.sections.map((s) => [s.id, s.startLine, s.endLine]), parseSkill(SKILL).sections.map((s) => [s.id, s.startLine, s.endLine]));
});

test('slugOf lowercases, drops punctuation and never returns an empty id', () => {
  assert.equal(slugOf('Step 1: Do the Thing!'), 'step-1-do-the-thing');
  assert.equal(slugOf('???'), 'section');
});
