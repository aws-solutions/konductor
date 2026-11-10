// SPDX-License-Identifier: Apache-2.0
/**
 * Data tests for bench/skill-evals: the curated skill eval bundle.
 *
 * Run: node --test tests/scripts/bench-skill-evals-data.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..', 'bench', 'skill-evals');
const SKILLS = path.join(ROOT, 'skills');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lines = (p) =>
  fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

const allFiles = walk(SKILLS);
const skillNames = fs
  .readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

test('allowlist matches the skill directories and records its source sha', () => {
  const allow = lines(path.join(ROOT, 'ALLOWLIST.txt'));
  assert.equal(allow.length, 81);
  assert.deepEqual([...allow].sort(), skillNames);
  assert.match(fs.readFileSync(path.join(ROOT, 'ALLOWLIST.sha'), 'utf8').trim(), /^[0-9a-f]{40}$/);
});

test('every skill has queries.json and scenario.json, and every JSON file parses', () => {
  for (const name of skillNames) {
    for (const f of ['queries.json', 'scenario.json']) {
      assert.ok(fs.existsSync(path.join(SKILLS, name, f)), `${name}/${f} missing`);
    }
  }
  for (const f of allFiles.filter((p) => p.endsWith('.json'))) readJson(f);
});

test('bundle counts are stable', () => {
  let cases = 0;
  let expectations = 0;
  let scripted = 0;
  let withEvals = 0;
  let prompts = 0;
  let rubric = 0;
  let floor = 0;
  let queries = 0;
  for (const name of skillNames) {
    const dir = path.join(SKILLS, name);
    const evalsPath = path.join(dir, 'evals.json');
    if (fs.existsSync(evalsPath)) {
      withEvals += 1;
      for (const e of readJson(evalsPath).evals) {
        cases += 1;
        expectations += (e.expectations || []).length;
        scripted += (e.scripted_checks || []).length;
      }
    }
    for (const p of readJson(path.join(dir, 'scenario.json')).prompts) {
      prompts += 1;
      rubric += (p.rubric || []).length;
      floor += (p.floor_checks || []).length;
    }
    queries += readJson(path.join(dir, 'queries.json')).length;
  }
  assert.deepEqual(
    { withEvals, cases, expectations, scripted, prompts, rubric, floor, queries },
    {
      withEvals: 66,
      cases: 145,
      expectations: 935,
      scripted: 245,
      prompts: 246,
      rubric: 1041,
      floor: 370,
      queries: 1618,
    },
  );
});

test('every scenario fixture path exists', () => {
  for (const name of skillNames) {
    const dir = path.join(SKILLS, name);
    for (const p of readJson(path.join(dir, 'scenario.json')).prompts) {
      if (p.fixture) assert.ok(fs.existsSync(path.join(dir, p.fixture)), `${name}/${p.id}: ${p.fixture}`);
    }
  }
});

test('manifest lists every file under skills/ with its sha256', () => {
  const manifest = new Map();
  for (const l of lines(path.join(ROOT, 'MANIFEST.sha256'))) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(l);
    assert.ok(m, `bad manifest line: ${l}`);
    manifest.set(m[2], m[1]);
  }
  assert.deepEqual([...manifest.keys()].sort(), allFiles.map(rel).sort());
  for (const f of allFiles) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    assert.equal(manifest.get(rel(f)), sha, `${rel(f)} changed since the manifest was written`);
  }
});

test('no em dash, en dash or curly quote in JSON or markdown outside the exemption list', () => {
  const exempt = new Set(lines(path.join(ROOT, 'DASH-FIXTURES.txt')));
  for (const p of exempt) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `exempt path missing: ${p}`);
    assert.match(fs.readFileSync(path.join(ROOT, p), 'utf8'), /[\u2013\u2014\u2018\u2019\u201C\u201D]/, `${p} is exempt but has none`);
  }
  const bad = allFiles
    .filter((f) => /\.(json|md)$/.test(f) && !exempt.has(rel(f)))
    .filter((f) => /[\u2013\u2014\u2018\u2019\u201C\u201D]/.test(fs.readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(bad, []);
});

test('scripted range checks match an en dash through the escaped form', () => {
  for (const name of ['adversarial-code-review', 'adversarial-code-review-pass-schema']) {
    const text = fs.readFileSync(path.join(SKILLS, name, 'scenario.json'), 'utf8');
    assert.ok(text.includes('[-\\\\u2013]'), `${name} lost the escaped en dash range`);
  }
});

test('catalog/queries.jsonl is not part of the bundle', () => {
  assert.equal(allFiles.filter((f) => f.endsWith('queries.jsonl')).length, 0);
  assert.ok(!fs.existsSync(path.join(ROOT, 'catalog')));
});
