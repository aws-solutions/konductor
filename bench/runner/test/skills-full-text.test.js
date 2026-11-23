// SPDX-License-Identifier: Apache-2.0
'use strict';

// A skill load counts as full only when the model got the whole skill text. kiro-cli 3.5.0 cuts any tool answer over
// 30,000 characters to a head-and-tail preview; such a load stays in skillsLoaded (the agent asked and got an answer)
// but not in skillsLoadedFull, and is counted in skillLoadsPreview.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSkills, resultFields, FULL_TEXT_FIELDS, isPreviewText } = require('../lib/skills.js');
const { validateResult } = require('../lib/result.js');
const { mkResult } = require('./helpers.js');

const TOOL_ID = 'tool::konductor-skills::get_skill';
const up = (u) => ({ type: 'sessionUpdate', data: { sessionId: 'sess_1', update: { ...u, _meta: { kiro: { serverName: 'konductor-skills' } } } } });
const call = (id, name) => up({ sessionUpdate: 'tool_call', toolCallId: id, title: '@konductor-skills/get_skill', rawInput: { tool_id: TOOL_ID, arguments: { name } } });
const answer = (id, name, rawOutput) => up({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', title: '@konductor-skills/get_skill', rawInput: { tool_id: TOOL_ID, arguments: { name } }, rawOutput });
const whole = (name) => { const r = JSON.stringify({ name, content: `# ${name}\n${'x'.repeat(300)}`, size_bytes: 310 }); return { response: r, imageBase64Urls: [], message: r }; };
// The shape kiro-cli 3.5.0 wrote in LITE (r2 t4-iam-privesc-groups): the notice in `message`, the cut JSON in `response`.
const preview = (name) => ({
  response: `{"name":"${name}","content":"---\\nname: ${name}\\n${'y'.repeat(400)}`,
  imageBase64Urls: [],
  message: `The output from "mcp_konductor_skills_get_skill" (38,598 chars) exceeded the 30,000-char limit; here is a preview of the tool's result:\n\n--- HEAD (first 500 chars) ---\n{"name":"${name}"`,
});
const shellRead = (id, file, text) => [
  up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Read File', rawInput: { operations: [{ mode: 'Line', path: file }] } }),
  up({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', title: 'Read File', content: [{ type: 'content', content: { type: 'text', text } }] }),
];

test('isPreviewText spots the kiro-cli cut notice and nothing else', () => {
  assert.equal(isPreviewText(preview('a').message), true);
  assert.equal(isPreviewText('The tool returned 30,000 rows; here is a preview'), false);
  assert.equal(isPreviewText(whole('a').response), false);
  assert.equal(isPreviewText(null), false);
});

test('a preview-only load is a load but not a full load', () => {
  const x = extractSkills([call('c1', 'iam-policy-design'), answer('c1', 'iam-policy-design', preview('iam-policy-design'))], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded.map((s) => s.name), ['iam-policy-design']);
  assert.deepEqual(x.skillsLoadedFull, []);
  assert.equal(x.skillLoadsPreview, 1);
});

test('a whole answer is a full load, and two loads of one skill count twice in both lists', () => {
  const x = extractSkills([
    call('c1', 'decision-writing'), answer('c1', 'decision-writing', whole('decision-writing')),
    call('c2', 'decision-writing'), answer('c2', 'decision-writing', whole('decision-writing')),
    call('c3', 'humanize-writing'), answer('c3', 'humanize-writing', preview('humanize-writing')),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded.map((s) => `${s.name}:${s.count}`), ['decision-writing:2', 'humanize-writing:1']);
  assert.deepEqual(x.skillsLoadedFull, [{ name: 'decision-writing', via: 'get_skill', count: 2 }]);
  assert.equal(x.skillLoadsPreview, 1);
});

test('reading the SKILL.md after a preview makes the skill a full load', () => {
  const x = extractSkills([
    call('c1', 'iam-policy-design'), answer('c1', 'iam-policy-design', preview('iam-policy-design')),
    ...shellRead('r1', '/tmp/h/home/.konductor/skills/iam-policy-design/SKILL.md', `---\nname: iam-policy-design\n---\n${'z'.repeat(200)}`),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoadedFull.map((s) => s.name), ['iam-policy-design']);
  assert.equal(x.skillLoadsPreview, 1, 'the preview is still counted');
});

test('resultFields carries both fields, and the result validates', () => {
  assert.deepEqual(FULL_TEXT_FIELDS, ['skillsLoadedFull', 'skillLoadsPreview', 'skillLoads']);
  const extraction = extractSkills([call('c1', 'a'), answer('c1', 'a', preview('a'))], 'kiro-cli');
  const f = resultFields({ extraction, info: null, task: { id: 't' }, arm: { id: 'konductor' } });
  assert.deepEqual(f.skillsLoadedFull, []);
  assert.equal(f.skillLoadsPreview, 1);
  const empty = resultFields({ extraction: null });
  assert.equal('skillsLoadedFull' in empty || 'skillLoadsPreview' in empty, false, 'no extraction: the fields are left out, as in older results');
  assert.deepEqual(validateResult(mkResult({ harness: 'kiro-cli', ...f, loadCheck: null })), []);
});

// ---- per-load whole or cut (skillLoads) ----

// A preview whose tail carries the skill's size, as kiro-cli's does (the JSON ends with "size_bytes").
const sizedPreview = (name, size) => ({ ...preview(name), message: `${preview(name).message}\n--- TAIL ---\n","size_bytes":${size}}\n--- END ---` });
const shell = (id, cmd, text) => [
  up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Run Command', rawInput: { command: cmd } }),
  up({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', title: 'Run Command', content: [{ type: 'content', content: { type: 'text', text } }] }),
];
const FILE = '/tmp/h/home/.konductor/skills/big/SKILL.md';

test('skillLoads: one entry per load in order, cut and whole per load', () => {
  const x = extractSkills([
    call('c1', 'small'), answer('c1', 'small', whole('small')),
    call('c2', 'big'), answer('c2', 'big', sizedPreview('big', 1000)),
  ], 'kiro-cli');
  assert.deepEqual(x.skillLoads.map(({ name, via, cut, whole: w }) => ({ name, via, cut, whole: w })), [
    { name: 'small', via: 'get_skill', cut: false, whole: true },
    { name: 'big', via: 'get_skill', cut: true, whole: false },
  ]);
  assert.equal(x.skillLoads[1].sizeBytes, 1000);
});

test('a cut load read back in two slices that cover the file becomes whole; the slices are not whole on their own', () => {
  const x = extractSkills([
    call('c1', 'big'), answer('c1', 'big', sizedPreview('big', 1000)),
    ...shell('s1', `head -c 500 ${FILE}`, 'a'.repeat(500)),
    ...shell('s2', `tail -c +500 ${FILE} | head -c 600`, 'b'.repeat(501)),
  ], 'kiro-cli');
  assert.deepEqual(x.skillLoads.map((l) => [l.via, l.cut, l.whole]), [['get_skill', true, true], ['shell-read-skill-md', true, false], ['shell-read-skill-md', true, true]]);
  assert.equal(x.skillLoads[0].recovered, true);
  assert.deepEqual(x.skillsLoadedFull.map((s) => s.name), ['big']);
});

test('a read back that covers 96% of the file leaves the load cut', () => {
  const x = extractSkills([
    call('c1', 'big'), answer('c1', 'big', sizedPreview('big', 1000)),
    ...shell('s1', `head -c 960 ${FILE}`, 'a'.repeat(960)),
  ], 'kiro-cli');
  assert.equal(x.skillLoads[0].whole, false);
  assert.deepEqual(x.skillsLoadedFull, []);
});

test('a SKILL.md read that itself came back as a preview is cut, and recovers nothing', () => {
  const x = extractSkills([
    call('c1', 'big'), answer('c1', 'big', sizedPreview('big', 1000)),
    ...shellRead('r1', FILE, preview('big').message),
  ], 'kiro-cli');
  assert.deepEqual(x.skillLoads.map((l) => [l.cut, l.whole]), [[true, false], [true, false]]);
  assert.deepEqual(x.skillsLoadedFull, []);
});

test('resultFields carries skillLoads, and the result validates', () => {
  const extraction = extractSkills([call('c1', 'big'), answer('c1', 'big', sizedPreview('big', 1000))], 'kiro-cli');
  const f = resultFields({ extraction, info: null, task: { id: 't' }, arm: { id: 'konductor' } });
  assert.equal(f.skillLoads.length, 1);
  assert.ok(FULL_TEXT_FIELDS.includes('skillLoads'));
  assert.deepEqual(validateResult(mkResult({ harness: 'kiro-cli', ...f, loadCheck: null })), []);
});
