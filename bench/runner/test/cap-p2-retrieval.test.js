// SPDX-License-Identifier: Apache-2.0
'use strict';

// The offline find_skills reimplementation. The semantics come from the skill-lookup index: name is a substring of the
// name, keyword is a substring of the name or of the description (checked per field), tag is an exact match, all
// given filters must match (AND), results sort by lower-case name, and the agent's name filter is a `*` glob list.
// When BENCH_SKILL_LOOKUP_BIN names a built skill-lookup-mcp binary the same queries also run against it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { skillRecords, filterRecords, findSkills, matchGlob, tagsOfFrontmatter } = require('../../cap/retrieval.js');

function skillsTree(root, defs) {
  for (const [name, { description, tags, extra = '' }] of Object.entries(defs)) {
    write(path.join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${tags ? `tags: ${tags}\n` : ''}${extra}---\n\n# ${name}\n\nBody for ${name}.\n`);
  }
  return root;
}

const DEFS = {
  'backend-review': { description: 'Use when reviewing backend code for input handling and injection risks.', tags: '[review, security]' },
  'frontend-review': { description: 'Use when reviewing frontend components for accessibility.', tags: '[review, ui]' },
  'Delegation-Protocol': { description: 'Use when spawning any subagent or deciding who should handle a task.', tags: '[agents]' },
  foo: { description: 'bar' },
  'sprint-planning': { description: 'Plans sprints and capacity.', tags: '\n  [\n    planning,\n    scrum,\n  ]' },
};

function fixture() {
  const root = tmp();
  skillsTree(root, DEFS);
  return { root, records: skillRecords(root), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const names = (r) => r.records.map((x) => x.name);

test('records come from the frontmatter name, description and tags, including a tag list on the next lines', () => {
  const f = fixture();
  try {
    const sp = f.records.find((r) => r.name === 'sprint-planning');
    assert.deepEqual(sp.tags, ['planning', 'scrum']);
    assert.deepEqual(f.records.find((r) => r.name === 'backend-review').tags, ['review', 'security']);
    assert.deepEqual(f.records.find((r) => r.name === 'foo').tags, []);
    assert.ok(f.records.every((r) => r.sizeBytes > 0));
  } finally { f.done(); }
  assert.deepEqual(tagsOfFrontmatter('tags:\n  - a\n  - "b"'), ['a', 'b']);
});

test('name matches a case-insensitive substring of the name only', () => {
  const f = fixture();
  try {
    assert.deepEqual(names(findSkills(f.records, { name: 'REVIEW' })), ['backend-review', 'frontend-review']);
    assert.deepEqual(names(findSkills(f.records, { name: 'protocol' })), ['Delegation-Protocol']);
    assert.deepEqual(names(findSkills(f.records, { name: 'injection' })), [], 'the description is not searched by name');
  } finally { f.done(); }
});

test('keyword matches the name or the description, each on its own, never across the boundary', () => {
  const f = fixture();
  try {
    assert.deepEqual(names(findSkills(f.records, { keyword: 'injection' })), ['backend-review']);
    assert.deepEqual(names(findSkills(f.records, { keyword: 'foo' })), ['foo']);
    assert.deepEqual(names(findSkills(f.records, { keyword: 'bar' })), ['foo']);
    assert.deepEqual(names(findSkills(f.records, { keyword: 'oob' })), [], 'name foo plus description bar must not match oob');
  } finally { f.done(); }
});

test('tag is an exact, case-insensitive match', () => {
  const f = fixture();
  try {
    assert.deepEqual(names(findSkills(f.records, { tag: 'REVIEW' })), ['backend-review', 'frontend-review']);
    assert.deepEqual(names(findSkills(f.records, { tag: 'revie' })), []);
    assert.deepEqual(names(findSkills(f.records, { tag: 'scrum' })), ['sprint-planning']);
  } finally { f.done(); }
});

test('several filters are ANDed, and with none every skill comes back sorted by lower-case name', () => {
  const f = fixture();
  try {
    assert.deepEqual(names(findSkills(f.records, { name: 'review', tag: 'security' })), ['backend-review']);
    assert.deepEqual(names(findSkills(f.records, { name: 'review', keyword: 'accessibility' })), ['frontend-review']);
    assert.deepEqual(names(findSkills(f.records, { name: 'backend', keyword: 'accessibility' })), [], 'AND, not OR');
    assert.deepEqual(names(findSkills(f.records, {})), ['backend-review', 'Delegation-Protocol', 'foo', 'frontend-review', 'sprint-planning']);
  } finally { f.done(); }
});

test('a query whose capability exists is missed when the substring does not occur in its name or description', () => {
  const f = fixture();
  try {
    const miss = findSkills(f.records, { keyword: 'delegate' });
    assert.equal(miss.ok, true);
    assert.equal(names(miss).includes('Delegation-Protocol'), false, '"delegate" is not a substring of "delegation"');
    assert.deepEqual(names(findSkills(f.records, { keyword: 'delegat' })), ['Delegation-Protocol']);
    assert.deepEqual(names(findSkills(f.records, { keyword: 'code reviewer' })), [], 'a multi-word keyword is one substring');
  } finally { f.done(); }
});

test('bad arguments fail the way the server does: empty strings, other types and unknown keys are errors; tool-use notes are ignored', () => {
  const f = fixture();
  try {
    assert.match(findSkills(f.records, { name: '' }).error, /name must not be empty/);
    assert.match(findSkills(f.records, { keyword: 7 }).error, /keyword must be a string/);
    assert.match(findSkills(f.records, { query: 'x' }).error, /unknown argument "query"/);
    assert.deepEqual(names(findSkills(f.records, { keyword: 'protocol', __tool_use_purpose: 'find it' })), ['Delegation-Protocol']);
    assert.match(findSkills(f.records, null).error, /arguments must be an object/);
  } finally { f.done(); }
});

test('the agent name filter is a comma list of * globs matched case-insensitively', () => {
  assert.equal(matchGlob('*', 'anything'), true);
  assert.equal(matchGlob('back*', 'backend-review'), true);
  assert.equal(matchGlob('*review', 'backend-review'), true);
  assert.equal(matchGlob('*end*', 'backend-review'), true);
  assert.equal(matchGlob('backend', 'backend-review'), false);
  assert.equal(matchGlob('BACKEND-review', 'backend-REVIEW'), true);
  assert.equal(matchGlob('a.c', 'abc'), false, 'other regex characters are literal');
  const f = fixture();
  try {
    assert.deepEqual(filterRecords(f.records, ['backend-review', 'delegation-*']).map((r) => r.name), ['backend-review', 'Delegation-Protocol']);
    assert.equal(filterRecords(f.records, null).length, 5);
    assert.deepEqual(names(findSkills(filterRecords(f.records, ['foo']), { name: 'review' })), [], 'a filtered-out skill cannot be found');
  } finally { f.done(); }
});

test('the result record has the fields the server returns', () => {
  const f = fixture();
  try {
    const [r] = findSkills(f.records, { name: 'foo' }).records;
    assert.deepEqual(Object.keys(r), ['name', 'description', 'tags', 'version', 'size_bytes', 'provenance']);
    assert.equal(r.version, null);
  } finally { f.done(); }
});

// ---- the same queries against a real skill-lookup-mcp over stdio (opt-in: needs a built binary) ----

function mcpCall(bin, args, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH, HOME: args.home } });
    let buf = '';
    const out = {};
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); calls.forEach((c, k) => send({ jsonrpc: '2.0', id: 10 + k, method: 'tools/call', params: { name: 'find_skills', arguments: c } })); }
        else if (m.id >= 10) { out[m.id - 10] = m; if (Object.keys(out).length === calls.length) { child.kill(); resolve(calls.map((_, k) => out[k])); } }
      }
    });
    child.on('error', reject);
    setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 20000).unref();
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench-test', version: '0' } } });
  });
}

test('the reimplementation agrees with the real skill-lookup-mcp on the same skills, filter and queries', { skip: !process.env.BENCH_SKILL_LOOKUP_BIN && 'set BENCH_SKILL_LOOKUP_BIN to a built skill-lookup-mcp to run this' }, async () => {
  const f = fixture();
  const home = tmp();
  try {
    const filter = ['backend-review', 'frontend-review', 'delegation-*', 'foo', 'sprint-planning'];
    const queries = [{ name: 'review' }, { keyword: 'injection' }, { keyword: 'oob' }, { tag: 'review' }, { name: 'review', tag: 'ui' }, { keyword: 'delegate' }, { keyword: 'delegat' }, {}];
    const args = ['--skills-dir', path.join(f.root, 'skills'), '--skill-name-filter', filter.join(',')];
    args.home = home;
    const real = await mcpCall(process.env.BENCH_SKILL_LOOKUP_BIN, args, queries);
    const mine = filterRecords(f.records, filter);
    queries.forEach((q, i) => {
      const text = real[i]?.result?.content?.[0]?.text;
      assert.ok(text, `no reply for ${JSON.stringify(q)}: ${JSON.stringify(real[i])}`);
      assert.deepEqual(names(findSkills(mine, q)), JSON.parse(text).map((r) => r.name), JSON.stringify(q));
    });
  } finally { f.done(); fs.rmSync(home, { recursive: true, force: true }); }
});
