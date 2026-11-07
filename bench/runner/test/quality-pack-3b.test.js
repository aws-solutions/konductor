// SPDX-License-Identifier: Apache-2.0
'use strict';

// The diagram, design, guide and task additions to the quality pack. Pack content, gating on synthetic files, quote checking
// and the frozen fingerprint of the earlier criteria. No model call and no runner process.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../judge/pack/index.js');

const pack = P.loadPack('quality');
const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quality-pack-66.json'), 'utf8'));
const fingerprint = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// Criteria whose text was extended on purpose; everything else must match its frozen fingerprint exactly.
const EXTENDED = new Set(['des-consistency']);

test('every criterion of the earlier pack keeps its text, weight, evidence rule and artifact types unless it is listed as extended', () => {
  assert.equal(Object.keys(frozen.criteria).length, 66);
  for (const [id, old] of Object.entries(frozen.criteria)) {
    const now = pack.criteria.find((c) => c.id === id);
    assert.ok(now, `${id} was removed`);
    const { appliesTo, ...rest } = now;
    assert.deepEqual(appliesTo, old.appliesTo, `${id}: artifact types changed`);
    if (!EXTENDED.has(id)) assert.equal(fingerprint(rest), old.fingerprint, `${id}: text, weight or evidence rule changed`);
  }
});

test('the counted-criteria lists, artifact types and earlier dimensions are unchanged', () => {
  for (const [key, sha] of Object.entries(frozen.data)) assert.equal(fingerprint(pack[key]), sha, key);
  assert.equal(fingerprint(pack.dimensions.slice(0, 13)), frozen.dimensions, 'the first 13 dimensions keep their ids, labels and order');
});

test('task declarations of the earlier pack are unchanged', () => {
  for (const [id, list] of Object.entries(frozen.taskArtifacts)) assert.deepEqual(pack.taskArtifacts[id], list, id);
});

const file = (rel, text, orig = null) => ({ rel, created: orig === null, binary: false, text, orig });
const status = (app) => Object.fromEntries(app.criteria.map((c) => [c.criterion.id, c]));
const byId = (id) => pack.criteria.find((c) => c.id === id);
const ids = (dim) => pack.criteria.filter((c) => c.dimension === dim).map((c) => c.id);
const DESIGN_TASK = { id: 'design-hold-service', class: 'design', prompt: 'Write a design.' };

const DESIGN_DOC = [
  '# Hold service', '', 'The member posts to /holds and the Hold API enqueues the hold.', '',
  '```mermaid', 'sequenceDiagram', '  Member->>HoldAPI: POST /holds', '  HoldAPI->>Queue: enqueue(hold)', '```', '',
  '```mermaid', 'erDiagram', '  HOLD }o--|| MEMBER : placed_by', '```', '',
].join('\n');
const bundleOf = (rel, text) => `## Files created or changed (1)\n### ${rel} (created)\n${text}`;

// ---- diagrams ----

test('the diagram dimension holds the presence, fit and label criteria, all for design documents', () => {
  assert.deepEqual(P.validatePack(pack), []);
  assert.deepEqual(ids('design-diagrams'), ['des-diagram-present', 'des-diagram-fit', 'des-diagram-labels']);
  for (const id of ids('design-diagrams')) assert.deepEqual(byId(id).appliesTo, ['design'], id);
  assert.equal(pack.dimensions.find((d) => d.id === 'design-diagrams').label, 'Diagrams in design documents');
});

test('the diagram criteria name the five views and tell the judge that fenced diagram lines can be quoted', () => {
  const present = byId('des-diagram-present').question;
  for (const view of ['sequence', 'component or class', 'data flow', 'data model', 'API schema']) assert.match(present, new RegExp(view, 'i'), view);
  for (const id of ids('design-diagrams')) assert.match(byId(id).evidence.quote, /fenced block/, id);
  assert.equal(byId('des-diagram-fit').evidence.minQuotes, 2);
  assert.match(byId('des-diagram-fit').evidence.quote, /one line from a diagram .* and the prose line it must match/);
});

test('des-consistency counts diagrams as a source and keeps its thresholds, weight and two-quote rule', () => {
  const c = byId('des-consistency');
  assert.deepEqual([c.dimension, c.weight, c.evidence.minQuotes], ['design-doc', 3, 2]);
  for (const text of [c.question, c.levels.fail, c.levels.partial, c.levels.pass, c.evidence.quote]) assert.match(text, /diagram/i);
  assert.match(c.levels.fail, /^In 2 or more places/);
  assert.match(c.levels.partial, /^Exactly 1 field, status or type differs/);
});

test('a design with fenced diagrams gets the diagram criteria judged; a task that does not ask for a design gets n/a', () => {
  const doc = file('docs/design/hold-service.md', DESIGN_DOC);
  const made = status(P.applicability(pack, DESIGN_TASK, [doc]));
  for (const id of ids('design-diagrams')) assert.equal(made[id].status, 'judged', id);
  const other = status(P.applicability(pack, { id: 'review-x', class: 'review', prompt: 'Review.' }, [doc]));
  for (const id of ids('design-diagrams')) assert.equal(other[id].status, 'na', id);
  const missing = status(P.applicability(pack, DESIGN_TASK, []));
  for (const id of ids('design-diagrams')) assert.equal(missing[id].status, 'absent', id);
  assert.ok(P.absentCriteria(P.applicability(pack, DESIGN_TASK, []).criteria).filter((r) => ids('design-diagrams').includes(r.id)).every((r) => r.verdict === 'fail'));
});

test('the judge is shown the fenced diagram lines in the output and in the changes, with the criterion text and quote rule', () => {
  const doc = file('docs/design/hold-service.md', DESIGN_DOC);
  const changes = P.diffText(P.changeStats([doc]));
  assert.match(changes, /^\+  Member->>HoldAPI: POST \/holds$/m);
  assert.match(changes, /^\+```mermaid$/m);
  const crit = ids('design-diagrams').map(byId);
  const prompt = P.packPrompt({ task: { prompt: 'Write a design.' }, answerKey: null, bundleText: bundleOf(doc.rel, DESIGN_DOC), changesText: changes, criteria: crit });
  assert.match(prompt, /^  Member->>HoldAPI: POST \/holds$/m);
  assert.match(prompt, /### des-diagram-fit \(design-diagrams, weight 3\)/);
  assert.match(prompt, /Quote: .*fenced blocks and are quoted as they appear.* Give 2 quotes\./);
});

test('a diagram line and the prose line it matches are accepted as evidence; an invented diagram line drops the verdict a level', () => {
  const crit = [byId('des-diagram-fit'), byId('des-diagram-present')];
  const bundle = bundleOf('docs/design/hold-service.md', DESIGN_DOC);
  const real = 'HoldAPI->>Queue: enqueue(hold) @@ the Hold API enqueues the hold';
  const invented = 'HoldAPI->>Cache: warm(hold) @@ the Hold API enqueues the hold';
  const out = P.scoreReply([
    { id: 'des-diagram-fit', verdict: 'pass', evidence: real },
    { id: 'des-diagram-present', verdict: 'pass', evidence: 'erDiagram' },
  ], crit, bundle);
  assert.deepEqual(out.map((c) => [c.verdict, c.evidenceFound]), [['pass', true], ['pass', true]]);
  const bad = P.scoreReply([{ id: 'des-diagram-fit', verdict: 'pass', evidence: invented }], [byId('des-diagram-fit')], bundle);
  assert.deepEqual([bad[0].verdict, bad[0].verdictRaw, bad[0].evidenceFound], ['partial', 'pass', false]);
  const oneQuote = P.scoreReply([{ id: 'des-diagram-fit', verdict: 'pass', evidence: 'HoldAPI->>Queue: enqueue(hold)' }], [byId('des-diagram-fit')], bundle);
  assert.equal(oneQuote[0].verdict, 'partial');
});

test('the counted prose criteria still skip fenced diagrams, so a dash inside a diagram label is not a typography hit', () => {
  const text = ['# Design', '', 'Plain prose here.', '', '```mermaid', 'sequenceDiagram', '  A->>B: hold \u2014 reserve', '```', ''].join('\n');
  const app = status(P.applicability(pack, DESIGN_TASK, [file('docs/design/x.md', text)]));
  const [res] = P.autoCriteria(pack, [{ status: 'auto', criterion: app['cq-plain-typography'].criterion, text: app['cq-plain-typography'].text }]);
  assert.equal(res.count, 0);
  assert.equal(res.verdict, 'pass');
});

// ---- architecture, goals, decisions, operability and rollout ----

test('the design additions sit in the dimensions listed for them and apply to design documents only', () => {
  const added = { 'design-doc': ['des-architecture', 'des-goals-nongoals', 'des-adr-consequences'], 'design-operations': ['des-operability', 'des-rollout-migration'] };
  for (const [dim, list] of Object.entries(added)) {
    const have = ids(dim);
    for (const id of list) {
      assert.ok(have.includes(id), `${id} in ${dim}`);
      assert.deepEqual(byId(id).appliesTo, ['design'], id);
    }
  }
  assert.deepEqual(ids('design-operations'), added['design-operations']);
  assert.equal(pack.dimensions.find((d) => d.id === 'design-operations').label, 'Operability and rollout of design');
});

test('the design additions are judged for a produced design, absent when none was written, and n/a for other tasks', () => {
  const names = ['des-architecture', 'des-goals-nongoals', 'des-adr-consequences', 'des-operability', 'des-rollout-migration'];
  const doc = file('docs/design/hold-service.md', '# Design\n\nGoals: serve holds.\n');
  const made = status(P.applicability(pack, DESIGN_TASK, [doc]));
  const missing = status(P.applicability(pack, DESIGN_TASK, []));
  const plan = status(P.applicability(pack, { id: 'plan-multipart-feature', class: 'sop', prompt: 'Plan.' }, [file('docs/plan.md', '# Plan\n')]));
  for (const id of names) {
    assert.equal(made[id].status, 'judged', id);
    assert.equal(missing[id].status, 'absent', id);
    assert.equal(plan[id].status, 'na', id);
  }
});

test('a design criterion takes one quote from the output and downgrades a verdict whose quote is invented', () => {
  const text = '# Design\n\n## Rollout\n1. Deploy the queue worker behind a flag. Undo: switch the flag off.\n';
  const bundle = bundleOf('docs/design/hold-service.md', text);
  const crit = [byId('des-rollout-migration')];
  const real = P.scoreReply([{ id: 'des-rollout-migration', verdict: 'pass', evidence: 'Undo: switch the flag off.' }], crit, bundle)[0];
  const made = P.scoreReply([{ id: 'des-rollout-migration', verdict: 'pass', evidence: 'Undo: restore the snapshot.' }], crit, bundle)[0];
  assert.deepEqual([real.verdict, real.evidenceFound], ['pass', true]);
  assert.deepEqual([made.verdict, made.evidenceFound], ['partial', false]);
});
