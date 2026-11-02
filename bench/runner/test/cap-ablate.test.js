// SPDX-License-Identifier: Apache-2.0
'use strict';

// Candidate sections and the variant texts for one skill: control, delete, remove a section, move it to references.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSkill } = require('../../cap/sections.js');
const { candidateSections, buildVariants, removeSection, moveSection } = require('../../cap/ablate.js');

const filler = (n, word) => Array.from({ length: n }, (_, i) => `${word} line ${i + 1} with enough words to take some bytes.`).join('\n');

const SKILL = `---
name: demo
description: Use when demoing things.
---

# Demo

Opening words.

## Workflow

${filler(30, 'workflow')}

## Output template

\`\`\`md
# Report
${filler(30, 'tmpl')}
\`\`\`

## Tiny

short.

## Checklist

${filler(25, 'check')}
`;

const parsed = () => parseSkill(SKILL);

test('candidates are level-2 sections over the size floor, in document order, and never the preamble', () => {
  const c = candidateSections(parsed(), { minBytes: 500 });
  assert.deepEqual(c.map((s) => s.id), ['workflow', 'output-template', 'checklist']);
  assert.equal(c.some((s) => s.level === 1), false);
});

test('max keeps the largest sections but returns them in document order', () => {
  const c = candidateSections(parsed(), { minBytes: 500, max: 2 });
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((s) => s.startLine), [...c.map((s) => s.startLine)].sort((a, b) => a - b));
  const all = candidateSections(parsed(), { minBytes: 500 });
  const ids = new Set(c.map((s) => s.id));
  const dropped = all.find((s) => !ids.has(s.id));
  assert.ok(c.every((s) => s.bytes >= dropped.bytes));
});

test('a big section also offers its level-3 children, and a skill with no headings offers none', () => {
  const big = `---\nname: b\ndescription: d\n---\n\n# B\n\n## Big\n\n### One\n\n${filler(40, 'one')}\n\n### Two\n\n${filler(40, 'two')}\n`;
  const ids = candidateSections(parseSkill(big), { minBytes: 500, splitBytes: 2000 }).map((s) => s.id);
  assert.deepEqual(ids, ['big', 'one', 'two']);
  assert.deepEqual(candidateSections(parseSkill('---\nname: x\n---\n\nplain text only\n'), {}), []);
});

test('removeSection deletes exactly the section lines and leaves no doubled blank line', () => {
  const p = parsed();
  const s = p.sections.find((x) => x.id === 'output-template');
  const out = removeSection(SKILL, s);
  assert.doesNotMatch(out, /Output template/);
  assert.doesNotMatch(out, /\n\n\n/);
  const before = SKILL.split('\n');
  const after = out.split('\n');
  assert.deepEqual(after.slice(0, s.startLine - 1), before.slice(0, s.startLine - 1));
  assert.match(out, /## Tiny/);
});

test('moveSection keeps the heading, adds an open-when pointer and returns the section body as the reference file', () => {
  const p = parsed();
  const s = p.sections.find((x) => x.id === 'output-template');
  const { text, refPath, refText } = moveSection(SKILL, s, { openWhen: 'you write the report' });
  assert.equal(refPath, 'references/output-template.md');
  assert.match(text, /## Output template\n\n`references\/output-template\.md` holds the full text of this section\./);
  assert.match(text, /Read `references\/output-template\.md` \(relative to this file\) when you write the report\./);
  assert.doesNotMatch(text, /# Report/);
  assert.match(refText, /^# Output template\n\n```md\n# Report/);
  assert.ok(refText.endsWith('\n'));
  assert.ok(Buffer.byteLength(text) < Buffer.byteLength(SKILL));
  assert.match(text, /## Tiny/);
});

test('a moved section loses no text: reference body plus the remaining text hold every original line', () => {
  const p = parsed();
  const s = p.sections.find((x) => x.id === 'workflow');
  const { text, refText } = moveSection(SKILL, s, {});
  const kept = new Set([...text.split('\n'), ...refText.split('\n')]);
  for (const line of SKILL.split('\n')) assert.ok(line === '' || kept.has(line), `missing: ${line}`);
});

test('buildVariants lists control, delete, and a remove and a move per candidate with ids, ranges and savings', () => {
  const p = parsed();
  const cands = candidateSections(p, { minBytes: 500 });
  const v = buildVariants({ name: 'demo', text: SKILL, candidates: cands });
  assert.deepEqual(v.map((x) => x.id), ['ctl', 'del', 'rm1', 'rm2', 'rm3', 'mv1', 'mv2', 'mv3']);
  const rm2 = v.find((x) => x.id === 'rm2');
  assert.equal(rm2.kind, 'remove');
  assert.equal(rm2.section.id, 'output-template');
  assert.deepEqual(rm2.range, { startLine: cands[1].startLine, endLine: cands[1].endLine });
  assert.equal(rm2.bytesSaved, Buffer.byteLength(SKILL) - Buffer.byteLength(rm2.text));
  assert.equal(rm2.tokensSaved, Math.round(rm2.bytesSaved / 4));
  const mv2 = v.find((x) => x.id === 'mv2');
  assert.equal(mv2.files['references/output-template.md'].length > 0, true);
  assert.ok(mv2.bytesSaved > 0 && mv2.bytesSaved < rm2.bytesSaved);
  assert.equal(v.find((x) => x.id === 'ctl').text, SKILL);
  assert.equal(v.find((x) => x.id === 'del').kind, 'delete');
});

test('every section variant keeps the frontmatter byte for byte', () => {
  const p = parsed();
  const head = SKILL.split('\n').slice(0, p.frontmatter.endLine).join('\n');
  for (const v of buildVariants({ name: 'demo', text: SKILL, candidates: candidateSections(p, { minBytes: 500 }) })) {
    if (v.text) assert.ok(v.text.startsWith(head), v.id);
  }
});

test('an open-when override is used and quotes nothing but the supplied words', () => {
  const p = parsed();
  const cands = candidateSections(p, { minBytes: 500 });
  const v = buildVariants({ name: 'demo', text: SKILL, candidates: cands, openWhen: { workflow: 'you plan the rollout' } });
  assert.match(v.find((x) => x.id === 'mv1').text, /when you plan the rollout\./);
});

test('applyCuts applies several cuts bottom-up, drops a cut inside another and returns the reference files', () => {
  const p = parsed();
  const by = Object.fromEntries(p.sections.map((s) => [s.id, s]));
  const { applyCuts } = require('../../cap/ablate.js');
  const r = applyCuts(SKILL, [{ section: by.workflow, action: 'remove' }, { section: by['output-template'], action: 'move', openWhen: 'you write it' }, { section: by.checklist, action: 'remove' }]);
  assert.doesNotMatch(r.text, /workflow line 3 /);
  assert.doesNotMatch(r.text, /## Checklist/);
  assert.match(r.text, /Read `references\/output-template\.md` \(relative to this file\) when you write it\./);
  assert.deepEqual(Object.keys(r.files), ['references/output-template.md']);
  const bottomUp = removeSection(moveSection(removeSection(SKILL, by.checklist), by['output-template'], { openWhen: 'you write it' }).text, by.workflow);
  assert.equal(r.text, bottomUp, 'cuts apply from the bottom so earlier line numbers stay valid');
  const nested = applyCuts(SKILL, [{ section: by.workflow, action: 'remove' }, { section: { ...by.workflow, startLine: by.workflow.startLine + 2, endLine: by.workflow.startLine + 4, id: 'x' }, action: 'remove' }]);
  assert.equal(nested.text, removeSection(SKILL, by.workflow));
});
