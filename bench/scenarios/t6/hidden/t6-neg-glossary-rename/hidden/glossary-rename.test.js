'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, readDoc, itemTexts } = require('./doc-key');

const glossary = () => blockOf('docs/glossary.md');
const prd = () => blockOf('docs/product-prd.md');

test('glossary records Project as the current term', () => {
  const block = glossary();
  assert.equal(block.term, 'Project');
  assert.equal(block.status, 'renamed');
});

test('glossary preserves the former Workspace label', () => {
  const block = glossary();
  assert.equal(block.previous_term, 'Workspace');
});

test('glossary definition describes the shared notes container', () => {
  const block = glossary();
  assert.match(block.definition, /shared space/i);
  assert.match(block.definition, /Project/i);
  assert.match(block.definition, /notes/i);
  assert.match(block.definition, /members/i);
});

test('glossary structured block has the required fields', () => {
  const block = glossary();
  assert.match(String(block.term || ''), /project/i, 'the shape counts once the entry is renamed');
  assert.deepEqual(Object.keys(block).sort(), ['definition', 'previous_term', 'status', 'term']);
});

test('PRD metrics block exists with three metrics', () => {
  const block = prd();
  assert.ok(Array.isArray(block.metrics));
  assert.equal(block.metrics.length, 3);
  assert.match(String(block.term_change?.to || ''), /^project$/i, 'the count counts once the rename is recorded');
  assert.ok(block.metrics.length <= 3, 'the metrics list must not grow with unrelated items');
});

test('every PRD metric uses Project instead of Workspace', () => {
  const block = prd();
  const metrics = itemTexts(block.metrics);
  assert.equal(metrics.length, 3);
  assert.ok(metrics.every((text) => /project/i.test(text)));
  assert.ok(metrics.every((text) => !/workspace/i.test(text)));
});

test('activation metric keeps its seven-day behavior', () => {
  const block = prd();
  const metric = block.metrics.find((m) => /activation/i.test(m.name));
  assert.ok(metric);
  assert.match(metric.name, /Project activation rate/i);
  assert.match(metric.definition, /create a Project/i);
  assert.match(metric.definition, /add at least one note within 7 days/i);
});

test('activation metric keeps its 31 percent baseline and 40 percent target', () => {
  const block = prd();
  const metric = block.metrics.find((m) => /activation/i.test(m.name));
  assert.ok(metric);
  assert.match(metric.name, /Project activation rate/i);
  assert.match(metric.baseline, /31\s*%/);
  assert.match(metric.baseline, /2024/);
  assert.match(metric.target, /40\s*%?/);
});

test('weekly active Project metric keeps its baseline and target', () => {
  const block = prd();
  const metric = block.metrics.find((m) => /weekly active/i.test(m.name));
  assert.ok(metric);
  assert.match(metric.name, /weekly active Projects/i);
  assert.match(metric.baseline, /2,?400/);
  assert.match(metric.target, /3,?000/);
});

test('invited-member metric is renamed without changing its numbers', () => {
  const block = prd();
  const metric = block.metrics.find((m) => /invited-member/i.test(m.name));
  assert.ok(metric);
  assert.match(metric.definition, /Project invitations/i);
  assert.match(metric.baseline, /18\s*%/);
  assert.match(metric.target, /25\s*%/);
});

test('PRD records the Workspace to Project change and preserves its narrative', () => {
  const block = prd();
  assert.deepEqual(block.term_change, { from: 'Workspace', to: 'Project' });
  const doc = readDoc('docs/product-prd.md');
  const narrativeEnd = doc.indexOf('## Metrics table');
  assert.ok(narrativeEnd > 0);
  assert.equal(doc.slice(0, narrativeEnd), `# Pinboard product requirements, Q1 planning draft

Owner: Inez Calder, product
Last reviewed: 2024-12-18

## Context

Pinboard helps small teams capture notes quickly, connect them to a shared Workspace, and find decisions later. The first-run experience should make the value of a shared container clear without requiring an admin workshop.

## Product requirements

- A new account can create a Workspace from the home screen.
- A member can add, search, and archive notes inside a Workspace.
- A Workspace owner can invite or remove members.
- Existing links to a Workspace continue to resolve after an account changes its display name.

`);
});

test('desk workspace remains an unrelated persona detail', () => {
  const block = glossary();
  assert.equal(block.term, 'Project');
  assert.match(readDoc('docs/persona-mara.md'), /desk workspace/i);
});

test('workspaceId code identifier remains unchanged', () => {
  const block = prd();
  assert.equal(block.term_change.to, 'Project');
  assert.match(readDoc('docs/engineering-notes.md'), /`workspaceId`/);
  assert.doesNotMatch(readDoc('docs/engineering-notes.md'), /`projectId`/);
});

test('each PRD metric keeps the documented metric fields', () => {
  const block = prd();
  assert.ok(!/workspace/i.test(JSON.stringify(block.metrics || [])), 'the fields count once the metrics are renamed');
  assert.ok(block.metrics.every((metric) => {
    assert.deepEqual(Object.keys(metric).sort(), ['baseline', 'definition', 'name', 'target']);
    return true;
  }));
});
