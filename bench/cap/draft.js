// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap draft` and `cap import`: candidate trigger queries for a capability, written to a scratch directory for a human
// to review. Splits are not assigned here and nothing is written into the repository.

const fs = require('node:fs');
const path = require('node:path');
const { judgeOnce } = require('../judge/run.js');
const { retrySuffix } = require('../judge/prompts.js');
const { descTokens, jaccard } = require('./text.js');
const { split } = require('./reach.js');
const { findMarker } = require('./public.js');

const TOOL = 'cap-draft/1';
const TEXT_MAX = 12000;
const MIN_PER_POLARITY = 6;
const QUERY_MIN = 12;
const QUERY_MAX = 400;
// Same pattern as the task validator: a query must not name a konductor procedure or agent.
const BANNED = /\bk-[a-z-]+\b|\bSOP\b|konductor|kiro-spec-workflow/i;
const DASHES = /[\u2013\u2014]/;

const draftFileName = (capId) => capId.replace(':', '-');

/** The `n` capabilities of the same kind whose descriptions overlap most with this one (Jaccard on content words). */
function neighboursFor(scan, capId, n = 5) {
  const me = scan.get(capId);
  if (!me) throw new Error(`unknown capability ${capId}`);
  const mine = descTokens(me.description.text);
  const scored = [];
  for (const c of scan.values()) {
    if (c.id === capId || c.kind !== me.kind || !c.description.present) continue;
    scored.push({ id: c.id, score: Math.round(jaccard(mine, descTokens(c.description.text)) * 1000) / 1000, description: c.description.text });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return scored.slice(0, n);
}

function capabilityText(cap) {
  if (cap.text.length <= TEXT_MAX) return cap.text;
  return `${cap.text.slice(0, TEXT_MAX)}\n[truncated at ${TEXT_MAX} characters; the file has ${cap.text.length}]`;
}

function buildDraftPrompt({ cap, neighbours, n = 24 }) {
  const each = Math.floor(n / 2);
  const sop = cap.kind === 'sop';
  const neigh = neighbours.length
    ? neighbours.map((x) => `- ${x.id}: ${x.description}`).join('\n')
    : '(none)';
  const shape = {
    queries: [{ text: 'a realistic user message', expect: 'load or none', nearMissOf: 'a neighbour id, only for expect none', rationale: 'one sentence: why this should or should not load it' }],
    taskIdeas: [{ title: 'short title', prompt: 'a task prompt that never names the capability', fixtureIdea: 'what a small fixture would contain', checkIdeas: ['a check that can be run on the result'] }],
    ...(sop ? { outputSections: ['a heading or file the SOP says its output must contain'] } : {}),
  };
  return `You are helping a maintainer test whether a coding assistant loads the right capability for a request. The capability is a ${cap.kind} named ${cap.name}. Its definition follows between the markers.

=== CAPABILITY ${cap.id} ===
${capabilityText(cap)}
=== END CAPABILITY ===

Its five most similar capabilities (by description overlap), which a keyword match could confuse it with:
${neigh}

Write ${n} candidate trigger queries as JSON: ${each} queries that should load this capability (expect "load") and ${each} that should not (expect "none").
Rules for the queries:
- Each is a realistic message a user would type to a coding assistant, ${QUERY_MIN} to ${QUERY_MAX} characters, one paragraph, no markdown.
- Vary the wording: some short and casual, some detailed with context, some that do not use the capability's own vocabulary.
- Never name the capability, its id or its tools, and do not use the words SOP, skill or agent or any name that starts with k-. No em dashes or en dashes.
- At least half of the should-not queries must be near misses: requests that belong to one of the similar capabilities above, so a keyword match on the topic would tempt a wrong load. Set nearMissOf to that capability's id (it must be one of the ids listed above). Other should-not queries are ordinary requests outside this capability's scope.
- Each query has a rationale of one sentence.
Also give exactly 2 taskIdeas: realistic small tasks (a prompt that never names the capability, an idea for a tiny fixture, and checks that could be run on the result) on which this capability should help.${sop ? '\nThis is a SOP: also list outputSections, the headings or files its own text says the output must contain (only what the text declares).' : ''}

Reply with JSON only, in this shape:
${JSON.stringify(shape, null, 1)}`;
}

/**
 * The skill name written as one term in any common spelling: the parts of a multi-part name joined by nothing or by one
 * hyphen, underscore, dot or space, in any case (backend-review, backend_review, Backend Review, BackendReview,
 * backend.review). One joiner at most, so "the backend. Review the" (a sentence end) and a line break do not match.
 * A one-part name is matched as a whole word only, as wordRe does.
 */
function nameVariantRe(name) {
  const parts = String(name).split(/[-_.\s]+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (parts.length < 2) return wordRe(name);
  return new RegExp(`(?<![A-Za-z0-9])${parts.join('[-_. ]?')}(?![A-Za-z0-9])`, 'i');
}

const wordRe = (name) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');

/**
 * The content checks on the text of one query, shared by `cap draft` (a model's reply) and `cap import` (a person's file):
 * one paragraph, no capability name, no konductor procedure or agent name, no dash, no public-repo marker. Returns a message
 * starting with "the text" or null. The first problem found is the one reported.
 */
function queryContentProblem(text, { capName, name = wordRe(capName) }) {
  if (/\n/.test(text)) return 'the text must be one paragraph';
  if (name.test(text)) return `the text names the capability "${capName}"`;
  const variant = nameVariantRe(capName);
  if (variant.test(text)) return `the text names the capability "${capName}" (as "${text.match(variant)[0]}")`;
  if (BANNED.test(text)) return 'the text names a konductor procedure or agent';
  if (DASHES.test(text)) return 'the text contains an em or en dash';
  const hit = findMarker(text);
  if (hit) return `the text has an ${hit.marker} (public-repo hygiene)`;
  return null;
}

/** Strict check of a model's reply; returns { ok: true, draft } or { ok: false, error } naming the first problem. */
function validateDraft(d, { capName, capKind, neighbourIds, n = 24 }) {
  const fail = (error) => ({ ok: false, error });
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('the reply must be a JSON object');
  if (!Array.isArray(d.queries)) return fail('queries must be an array');
  const seen = new Set();
  const name = wordRe(capName);
  for (const [i, x] of d.queries.entries()) {
    const at = `queries[${i}]`;
    if (!x || typeof x !== 'object') return fail(`${at} must be an object`);
    if (x.expect !== 'load' && x.expect !== 'none') return fail(`${at}.expect must be load or none`);
    if (typeof x.text !== 'string' || x.text.trim().length < QUERY_MIN || x.text.length > QUERY_MAX) return fail(`${at}.text must be between ${QUERY_MIN} and ${QUERY_MAX} characters`);
    if (typeof x.rationale !== 'string' || x.rationale.trim().length < 8) return fail(`${at}.rationale must be a non-empty sentence`);
    if (x.nearMissOf !== undefined) {
      if (x.expect !== 'none') return fail(`${at}: nearMissOf only applies to expect:none queries`);
      if (!neighbourIds.includes(x.nearMissOf)) return fail(`${at}: nearMissOf "${x.nearMissOf}" is not one of the neighbours (${neighbourIds.join(', ') || 'none'})`);
    }
    const bad = queryContentProblem(x.text, { capName, name });
    if (bad) return fail(`${at}: ${bad}`);
    const key = x.text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return fail(`${at}: duplicate query text`);
    seen.add(key);
  }
  const load = d.queries.filter((x) => x.expect === 'load').length;
  const none = d.queries.length - load;
  if (load < MIN_PER_POLARITY || none < MIN_PER_POLARITY) return fail(`too few queries: ${load} expect:load and ${none} expect:none, need at least ${MIN_PER_POLARITY} of each`);
  if (d.queries.length > n + 4) return fail(`too many queries (${d.queries.length}), at most ${n + 4}`);
  const near = d.queries.filter((x) => x.expect === 'none' && x.nearMissOf).length;
  if (neighbourIds.length && near * 2 < none) return fail(`at least half of the ${none} should-not queries must be near misses with nearMissOf set (${near} are)`);
  if (!Array.isArray(d.taskIdeas) || d.taskIdeas.length !== 2) return fail('exactly 2 taskIdeas are required');
  for (const [i, t] of d.taskIdeas.entries()) {
    if (!t || typeof t.title !== 'string' || typeof t.prompt !== 'string' || typeof t.fixtureIdea !== 'string' || !Array.isArray(t.checkIdeas) || !t.checkIdeas.every((c) => typeof c === 'string')) return fail(`taskIdeas[${i}] needs title, prompt, fixtureIdea and a checkIdeas array of strings`);
    if (name.test(t.prompt) || nameVariantRe(capName).test(t.prompt)) return fail(`taskIdeas[${i}].prompt names the capability "${capName}"`);
  }
  if (capKind === 'sop') {
    if (!Array.isArray(d.outputSections) || !d.outputSections.length || !d.outputSections.every((s) => typeof s === 'string' && s.trim())) return fail('outputSections must list the output sections the SOP declares (at least 1)');
  } else if (d.outputSections !== undefined && !(Array.isArray(d.outputSections) && d.outputSections.length === 0)) {
    return fail('outputSections only applies to SOPs');
  }
  return { ok: true, draft: d };
}

const pad2 = (i, w = 2) => String(i + 1).padStart(w, '0');

function assemble({ cap, neighbours, parsed, model, n, now }) {
  const queries = parsed.queries.map((x, i) => ({
    id: `d${pad2(i)}`, text: x.text.trim(), expect: x.expect, ...(x.nearMissOf ? { nearMissOf: x.nearMissOf } : {}), rationale: x.rationale.trim(),
  }));
  return {
    schemaVersion: 1, capId: cap.id, kind: cap.kind, status: 'draft-unreviewed',
    generatedBy: { tool: TOOL, model, n, at: now.toISOString() },
    neighbours: neighbours.map(({ id, score }) => ({ id, score })),
    queries, taskIdeas: parsed.taskIdeas,
    ...(cap.kind === 'sop' ? { outputSections: parsed.outputSections.map((s) => s.trim()) } : {}),
  };
}

const CHECKLIST = [
  'Read each query as a user would. Delete any that are unrealistic, ambiguous about which capability should load, or that name it.',
  'Check every near miss: it must belong to the neighbour it names and not to this capability.',
  'Assign `split` (train, heldout or reserve) yourself. The tool does not.',
  'Copy the approved queries into bench/capabilities/ as described in the review pack, then run `cap audit`.',
];

function renderDraftMd(d) {
  const L = [`# Draft trigger queries for ${d.capId}`, ''];
  L.push(`Status: ${d.status}. ${d.generatedBy.import ? `Imported from ${d.generatedBy.import}` : `Generated by ${d.generatedBy.tool} with ${d.generatedBy.model}`} at ${d.generatedBy.at}.`);
  L.push('No splits are assigned. Nothing here has been written into the repository.', '', '## Review checklist', '', ...CHECKLIST.map((c) => `- [ ] ${c}`), '');
  if (d.neighbours?.length) L.push('Nearest neighbours: ' + d.neighbours.map((x) => `${x.id} (${x.score})`).join(', '), '');
  for (const [title, expect] of [['Should load', 'load'], ['Should not load', 'none']]) {
    const qs = d.queries.filter((x) => x.expect === expect);
    L.push(`## ${title} (${qs.length})`, '');
    for (const x of qs) L.push(`- ${x.id}${x.nearMissOf ? ` (near miss of ${x.nearMissOf})` : ''}: ${x.text}`, `  - why: ${x.rationale}`);
    L.push('');
  }
  if (d.taskIdeas?.length) {
    L.push('## Task ideas', '');
    for (const t of d.taskIdeas) L.push(`- ${t.title}: ${t.prompt}`, `  - fixture: ${t.fixtureIdea}`, `  - checks: ${t.checkIdeas.join('; ')}`);
    L.push('');
  }
  if (d.outputSections?.length) L.push('## Declared output sections (for conformance checks)', '', ...d.outputSections.map((s) => `- ${s}`), '');
  return `${L.join('\n')}\n`;
}

function writeDraft(outDir, capId, draft) {
  const dir = path.join(outDir, 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${draftFileName(capId)}.json`);
  const mdFile = path.join(dir, `${draftFileName(capId)}.md`);
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  fs.writeFileSync(mdFile, renderDraftMd(draft));
  return { file, mdFile };
}

/**
 * One tool-less model call per capability (a second only when the first reply fails validation). `caller` is
 * async ({ model, prompt }) => { text, credits, error? }. Writes <outDir>/drafts/<id>.json and .md on success.
 */
async function draftCapability({ capId, scan, caller, model, n = 24, outDir, now = new Date() }) {
  const cap = scan.get(capId);
  if (!cap) throw new Error(`unknown capability ${capId}`);
  if (cap.kind === 'context') throw new Error(`${capId} cannot be triggered: context files are always loaded`);
  const neighbours = neighboursFor(scan, capId, 5);
  const ids = neighbours.map((x) => x.id);
  const prompt = buildDraftPrompt({ cap, neighbours, n });
  const out = await judgeOnce({ caller, model, prompt, check: (v) => validateDraft(v, { capName: cap.name, capKind: cap.kind, neighbourIds: ids, n }) });
  const credits = out.calls.reduce((s, c) => s + (c.credits || 0), 0);
  if (out.error) return { ok: false, error: out.error, credits, attempts: out.calls.length };
  const draft = assemble({ cap, neighbours, parsed: out.value.draft, model, n, now });
  return { ok: true, draft, credits, attempts: out.calls.length, ...writeDraft(outDir, capId, draft) };
}

/**
 * Skill-creator style [{ query, should_trigger }] into the draft format (should_trigger true -> expect load, false -> none).
 * The same checks as `cap draft` apply: query text rules, at least 6 queries of each polarity, at most n + 4 in all. Splits are
 * not accepted: a person assigns them after review. Near-miss labels cannot be carried by this format, so that rule is not applied.
 */
function importQueries(items, { capId, source, n = 24, now = new Date() }) {
  if (!Array.isArray(items)) throw new Error('the file must be a JSON array of { query, should_trigger }');
  if (!items.length) throw new Error('no queries in the file');
  const capName = capId.slice(capId.indexOf(':') + 1);
  const name = wordRe(capName);
  const seen = new Set();
  const queries = items.map((x, i) => {
    const at = `item ${i + 1}`;
    if (!x || typeof x.query !== 'string' || !x.query.trim()) throw new Error(`${at}: query must be a non-empty string`);
    if (typeof x.should_trigger !== 'boolean') throw new Error(`${at}: should_trigger must be true or false`);
    for (const key of ['split', 'splits']) if (key in x) throw new Error(`${at}: ${key} is assigned by a person after review, not on import`);
    if (x.query.trim().length < QUERY_MIN || x.query.length > QUERY_MAX) throw new Error(`${at}: the text must be between ${QUERY_MIN} and ${QUERY_MAX} characters`);
    const bad = queryContentProblem(x.query, { capName, name });
    if (bad) throw new Error(`${at}: ${bad}`);
    const key = x.query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) throw new Error(`${at}: duplicate query text`);
    seen.add(key);
    return { id: `i${pad2(i)}`, text: x.query.trim(), expect: x.should_trigger ? 'load' : 'none', rationale: `imported: should_trigger ${x.should_trigger}` };
  });
  const load = queries.filter((x) => x.expect === 'load').length;
  const none = queries.length - load;
  if (load < MIN_PER_POLARITY || none < MIN_PER_POLARITY) throw new Error(`too few queries: ${load} expect:load and ${none} expect:none, need at least ${MIN_PER_POLARITY} of each`);
  if (queries.length > n + 4) throw new Error(`too many queries (${queries.length}), at most ${n + 4}`);
  return {
    schemaVersion: 1, capId, kind: capId.slice(0, capId.indexOf(':')), status: 'draft-unreviewed',
    generatedBy: { tool: TOOL, import: source, at: now.toISOString() }, neighbours: [], queries, taskIdeas: [],
  };
}

module.exports = {
  neighboursFor, buildDraftPrompt, validateDraft, draftCapability, importQueries, renderDraftMd, writeDraft, draftFileName, retrySuffix, split, TOOL, BANNED, DASHES, wordRe, nameVariantRe, capabilityText, queryContentProblem,
};
