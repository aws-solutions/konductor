// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap draft and cap import: candidate trigger queries for human review. A fake model answers; nothing is written
// into the repository, and the tool never assigns splits.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, scratch, writeFiles } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { scanRepo } = require('../../cap/scan.js');
const { neighboursFor, buildDraftPrompt, validateDraft, draftCapability, importQueries, renderDraftMd, draftFileName } = require('../../cap/draft.js');
const { checkScratch } = require('../../cap/variant.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// Many similar skills so the five nearest neighbours are a known set.
function manySkills(repo) {
  writeFiles(repo);
  for (const [n, d] of [['n1', 'Use when reviewing backend code for input handling and injection hazards.'], ['n2', 'Use when reviewing backend code for input handling and escaping.'], ['n3', 'Use when reviewing backend input handling.'], ['n4', 'Use when reviewing code.'], ['n5', 'Use when reviewing frontend code for input.'], ['n6', 'Use when planning databases migrations.']]) {
    write(path.join(repo, `skills/${n}/SKILL.md`), `---\nname: ${n}\ndescription: ${d}\n---\n\n# ${n}\n`);
  }
}

const q = (i, expect, extra = {}) => ({ text: `Realistic request number ${i} about some everyday engineering work`, expect, rationale: `reason ${i} that explains it`, ...extra });

function goodDraft(neighbour = 'skill:delta', { load = 12, none = 12, near = 8 } = {}) {
  const queries = [];
  for (let i = 0; i < load; i++) queries.push(q(i, 'load'));
  for (let i = 0; i < none; i++) queries.push(q(100 + i, 'none', i < near ? { nearMissOf: neighbour } : {}));
  return { queries, taskIdeas: [{ title: 'one', prompt: 'Do a thing in the repo', fixtureIdea: 'a small repo', checkIdeas: ['file exists'] }, { title: 'two', prompt: 'Do another thing', fixtureIdea: 'notes', checkIdeas: ['pattern'] }] };
}

function setup() {
  const root = scratch();
  const r = makeCapRepo(root, { files: manySkills, tag: 'v0' });
  const scan = scanRepo(r.repo);
  return { root, scan, repo: r.repo, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the five nearest neighbours are the same-kind capabilities with the most description overlap, best first', () => {
  const s = setup();
  try {
    const n = neighboursFor(s.scan, 'skill:alpha', 5);
    assert.equal(n.length, 5);
    assert.equal(n[0].id, 'skill:delta');
    assert.ok(n.every((x) => x.id.startsWith('skill:') && x.id !== 'skill:alpha'));
    assert.ok(n.every((x, i) => i === 0 || n[i - 1].score >= x.score));
    assert.ok(n.every((x) => typeof x.description === 'string'));
    assert.equal(neighboursFor(s.scan, 'skill:alpha', 2).length, 2);
  } finally { s.done(); }
});

test('the prompt carries the capability text, the neighbour descriptions and the rules, and does not ask for splits', () => {
  const s = setup();
  try {
    const cap = s.scan.get('skill:alpha');
    const n = neighboursFor(s.scan, 'skill:alpha', 5);
    const p = buildDraftPrompt({ cap, neighbours: n, n: 24 });
    assert.match(p, /Validate every input\. Escape output\./);
    for (const x of n) assert.ok(p.includes(x.id), x.id);
    assert.match(p, /12 queries that should load/);
    assert.match(p, /nearMissOf/);
    assert.match(p, /never name the capability/i);
    assert.doesNotMatch(p, /\bsplit\b/i);
    const sop = buildDraftPrompt({ cap: s.scan.get('sop:k-plan'), neighbours: [], n: 24 });
    assert.match(sop, /outputSections/);
    assert.doesNotMatch(p, /outputSections/);
  } finally { s.done(); }
});

test('a long capability text is cut and the prompt says so', () => {
  const s = setup();
  try {
    const cap = { ...s.scan.get('skill:alpha'), text: `${'x'.repeat(20000)}\nTAIL-MARK` };
    const p = buildDraftPrompt({ cap, neighbours: [], n: 24 });
    assert.doesNotMatch(p, /TAIL-MARK/);
    assert.match(p, /truncated at 12000 characters/);
  } finally { s.done(); }
});

const ctx = (over = {}) => ({ capName: 'alpha', capKind: 'skill', neighbourIds: ['skill:delta', 'skill:n1'], n: 24, ...over });

test('a good draft validates', () => {
  const r = validateDraft(goodDraft(), ctx());
  assert.equal(r.ok, true, r.error);
});

test('validation catches the problems a reviewer would otherwise have to find', () => {
  const bad = (mutate, re, o) => {
    const d = goodDraft();
    mutate(d);
    const r = validateDraft(d, ctx(o));
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  };
  bad((d) => { d.queries = d.queries.slice(0, 10); }, /at least 6 .*load and 6 .*none|too few/i);
  bad((d) => { d.queries[0].expect = 'maybe'; }, /expect/);
  bad((d) => { d.queries[0].rationale = ''; }, /rationale/);
  bad((d) => { d.queries[13].nearMissOf = 'skill:not-a-neighbour'; }, /nearMissOf "skill:not-a-neighbour" is not one of the neighbours/);
  bad((d) => { d.queries[0].nearMissOf = 'skill:delta'; }, /nearMissOf only applies to expect:none/);
  bad((d) => { for (const x of d.queries) delete x.nearMissOf; }, /at least half of the 12 should-not queries must be near misses/);
  bad((d) => { d.queries[1].text = d.queries[0].text; }, /duplicate query text/);
  bad((d) => { d.queries[0].text = 'Please run alpha on my service for me today'; }, /names the capability "alpha"/);
  bad((d) => { d.queries[0].text = 'Ask the konductor orchestrator to review this change today'; }, /names a konductor procedure or agent/);
  bad((d) => { d.queries[0].text = 'Review this change \u2014 it is large and risky for us today'; }, /em or en dash/);
  bad((d) => { d.queries[0].text = 'short'; }, /between 12 and 400 characters/);
  bad((d) => { d.taskIdeas = [d.taskIdeas[0]]; }, /exactly 2 taskIdeas/);
  bad((d) => { d.queries = [...d.queries, ...d.queries.slice(0, 12).map((x, i) => ({ ...x, text: `${x.text} variant ${i}` }))]; }, /too many queries/);
  bad((d) => { delete d.queries; }, /queries/);
  bad((d) => { d.outputSections = ['Removed Items']; }, /outputSections only applies to SOPs/);
  const sop = goodDraft();
  assert.match(validateDraft(sop, ctx({ capKind: 'sop', capName: 'k-plan' })).error, /outputSections/);
  sop.outputSections = ['Plan', 'Risks'];
  assert.equal(validateDraft(sop, ctx({ capKind: 'sop', capName: 'k-plan' })).ok, true);
});

function fakeModel(replies) {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return typeof r === 'string' ? { text: r, credits: 0.2, latencyMs: 1 } : { credits: 0.2, latencyMs: 1, text: '', ...r };
  };
  fn.calls = calls;
  return fn;
}

test('draftCapability writes the JSON and a readable markdown copy, with a rationale per query and no splits', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const caller = fakeModel([JSON.stringify(goodDraft())]);
    const r = await draftCapability({ capId: 'skill:alpha', scan: s.scan, caller, model: 'm', n: 24, outDir: out });
    assert.equal(r.ok, true, r.error);
    const jf = path.join(out, 'drafts', 'skill-alpha.json');
    const mf = path.join(out, 'drafts', 'skill-alpha.md');
    assert.equal(r.file, jf);
    const d = JSON.parse(fs.readFileSync(jf, 'utf8'));
    assert.equal(d.capId, 'skill:alpha');
    assert.equal(d.status, 'draft-unreviewed');
    assert.equal(d.generatedBy.model, 'm');
    assert.equal(d.queries.length, 24);
    assert.ok(d.queries.every((x) => x.id && x.rationale && !('split' in x)));
    assert.equal(d.queries.filter((x) => x.expect === 'load').length, 12);
    assert.equal(d.neighbours.length, 5);
    const md = fs.readFileSync(mf, 'utf8');
    assert.match(md, /# Draft trigger queries for skill:alpha/);
    assert.match(md, /near miss of skill:delta/);
    assert.match(md, /Review checklist/);
    assert.equal(caller.calls.length, 1);
    assert.ok(Math.abs(r.credits - 0.2) < 1e-9);
    assert.equal(draftFileName('skill:alpha'), 'skill-alpha');
  } finally { s.done(); }
});

test('an invalid first reply is retried once with the reason; a second invalid reply writes nothing', async () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const retried = await draftCapability({ capId: 'skill:alpha', scan: s.scan, caller: fakeModel(['not json at all', JSON.stringify(goodDraft())]), model: 'm', n: 24, outDir: out });
    assert.equal(retried.ok, true);
    assert.equal(retried.attempts, 2);
    assert.ok(Math.abs(retried.credits - 0.4) < 1e-9);
    const bad = await draftCapability({ capId: 'skill:beta', scan: s.scan, caller: fakeModel(['nope', JSON.stringify({ queries: [] })]), model: 'm', n: 24, outDir: out });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /unusable after retry/);
    assert.equal(fs.existsSync(path.join(out, 'drafts', 'skill-beta.json')), false);
  } finally { s.done(); }
});

test('the retry prompt names what was wrong', async () => {
  const s = setup();
  try {
    const caller = fakeModel(['{"queries":[]}', JSON.stringify(goodDraft())]);
    await draftCapability({ capId: 'skill:alpha', scan: s.scan, caller, model: 'm', n: 24, outDir: path.join(s.root, 'out') });
    assert.match(caller.calls[1].prompt, /previous reply could not be used: .*queries/s);
  } finally { s.done(); }
});

test('drafting refuses an output directory inside the repository and an unknown capability', async () => {
  const s = setup();
  try {
    assert.throws(() => checkScratch(path.join(s.repo, 'drafts'), s.repo), /inside the repository/);
    await assert.rejects(draftCapability({ capId: 'skill:nope', scan: s.scan, caller: fakeModel(['{}']), model: 'm', n: 24, outDir: path.join(s.root, 'o') }), /unknown capability/);
    await assert.rejects(draftCapability({ capId: 'context:core', scan: s.scan, caller: fakeModel(['{}']), model: 'm', n: 24, outDir: path.join(s.root, 'o') }), /cannot be triggered/);
  } finally { s.done(); }
});

// ---- import ----

test('import reads skill-creator style [{query, should_trigger}] into the draft format', () => {
  const d = importQueries([
    { query: 'Check my service for injection problems before release', should_trigger: true },
    { query: 'Write a poem about the sea', should_trigger: false },
  ], { capId: 'skill:alpha', source: 'queries.json' });
  assert.equal(d.capId, 'skill:alpha');
  assert.equal(d.status, 'draft-unreviewed');
  assert.deepEqual(d.queries.map((x) => [x.id, x.expect]), [['i01', 'load'], ['i02', 'none']]);
  assert.ok(d.queries.every((x) => x.rationale.startsWith('imported')));
  assert.equal(d.generatedBy.import, 'queries.json');
  assert.deepEqual(d.taskIdeas, []);
});

test('import refuses malformed input with the position of the problem', () => {
  const run = (v) => importQueries(v, { capId: 'skill:alpha', source: 'f' });
  assert.throws(() => run({ not: 'an array' }), /must be a JSON array/);
  assert.throws(() => run([{ query: 'ok query text here', should_trigger: 'yes' }]), /item 1: should_trigger must be true or false/);
  assert.throws(() => run([{ should_trigger: true }]), /item 1: query must be a non-empty string/);
  assert.throws(() => run([{ query: 'same query text here', should_trigger: true }, { query: 'Same query text here', should_trigger: false }]), /item 2: duplicate query text/);
  assert.throws(() => run([]), /no queries/);
  assert.equal(renderDraftMd(run([{ query: 'a query that is long enough', should_trigger: true }])).includes('imported'), true);
});

// ---- the command ----

test('cap draft and cap import write into --out only, refuse a repo path, and leave the registry untouched', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const registryBefore = fs.readdirSync(path.join(bench, 'capabilities'));
    const qfile = path.join(s.root, 'q.json');
    fs.writeFileSync(qfile, JSON.stringify([{ query: 'Check my service for injection problems', should_trigger: true }, { query: 'Write a poem about the sea', should_trigger: false }]));
    const out = path.join(s.root, 'out');
    const env = { PATH: process.env.PATH, HOME: path.join(s.root, 'h') };
    fs.mkdirSync(env.HOME);
    const ok = spawnSync(process.execPath, [BENCH_JS, 'cap', 'import', '--from', qfile, '--cap', 'skill:alpha', '--out', out, '--repo-root', s.repo, '--bench-dir', bench], { encoding: 'utf8', env });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(fs.existsSync(path.join(out, 'drafts', 'skill-alpha.json')));
    assert.deepEqual(fs.readdirSync(path.join(bench, 'capabilities')), registryBefore);
    const inRepo = spawnSync(process.execPath, [BENCH_JS, 'cap', 'import', '--from', qfile, '--cap', 'skill:alpha', '--out', path.join(s.repo, 'x'), '--repo-root', s.repo, '--bench-dir', bench], { encoding: 'utf8', env });
    assert.equal(inRepo.status, 2);
    assert.match(inRepo.stderr, /inside the repository/);
    const noCap = spawnSync(process.execPath, [BENCH_JS, 'cap', 'draft', '--out', out, '--repo-root', s.repo, '--bench-dir', bench], { encoding: 'utf8', env });
    assert.equal(noCap.status, 2);
    assert.match(noCap.stderr, /--cap is required/);
  } finally { s.done(); }
});

test('cap draft with a command model writes the draft files, reports credits and never touches the bench directory', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const before = fs.readdirSync(bench).sort();
    const cmd = path.join(s.root, 'fake-model.js');
    write(cmd, `#!/usr/bin/env node\nlet t='';process.stdin.on('data',d=>t+=d).on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(goodDraft()))}));\n`);
    const out = path.join(s.root, 'out');
    const env = { PATH: process.env.PATH, HOME: path.join(s.root, 'h') };
    fs.mkdirSync(env.HOME);
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'draft', '--cap', 'skill:alpha', '--out', out, '--model-cmd', `node ${cmd}`, '--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skill:alpha: wrote .*skill-alpha\.json/);
    assert.ok(fs.existsSync(path.join(out, 'drafts', 'skill-alpha.md')));
    assert.deepEqual(fs.readdirSync(bench).sort(), before);
  } finally { s.done(); }
});
