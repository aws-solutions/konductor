#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Self-check for a task author, standalone (Node.js only). Run from the folder that holds fixture/, hidden/,
// solution/ and task-draft.json:  node kit/check-draft.js
// It plays the scripted user over solution/ASKS.json (one string per asking turn; topics are plain
// case-insensitive substrings, each fact answered once), then runs the hidden tests and the other checks on the reference
// (fixture + solution) and on the stub (the untouched fixture, no conversation), and prints an approximate score:
// (0.5 * hidden fraction + 0.2 * weighted substance checks) / 0.7. The bench's own dry run is the one that counts.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HERE = process.cwd();
const draft = JSON.parse(fs.readFileSync(path.join(HERE, 'task-draft.json'), 'utf8'));
const GENERIC = 'Is there anything else I should know before I start?';

function copy(src, dest, skip = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copy(s, d); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function converse(asks) {
  const done = new Set();
  return { questions: asks.map((text, i) => {
    const hit = draft.scriptedUser.facts.filter((f) => !done.has(f.id) && f.topics.some((t) => text.toLowerCase().includes(t.toLowerCase())));
    hit.forEach((f) => done.add(f.id));
    return { turn: i + 1, text, matched: hit.map((f) => f.id), count: Math.max(1, (text.match(/\?/g) || []).length) };
  }) };
}

function tree(dir, base = dir, out = new Map()) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tree(p, base, out); else out.set(path.relative(base, p), fs.readFileSync(p, 'utf8'));
  }
  return out;
}

function check(ws, c) {
  const f = c.path ? path.join(ws, c.path) : null;
  const text = () => (f && fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null);
  switch (c.type) {
    case 'file_exists': return text() !== null;
    case 'contains': { const t = text(); return t !== null && new RegExp(c.pattern, 'im').test(t); }
    case 'not_contains': { const t = text(); return t !== null && !new RegExp(c.pattern, 'im').test(t); }
    case 'min_matches': { const t = text(); return t !== null && (t.match(new RegExp(c.pattern, 'gim')) || []).length >= c.min; }
    case 'fixture_unchanged': {
      const a = tree(path.join(HERE, 'fixture', c.path), path.join(HERE, 'fixture', c.path));
      const b = tree(path.join(ws, c.path), path.join(ws, c.path));
      if (fs.existsSync(path.join(HERE, 'fixture', c.path)) && fs.statSync(path.join(HERE, 'fixture', c.path)).isFile()) return text() === fs.readFileSync(path.join(HERE, 'fixture', c.path), 'utf8');
      return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
    }
    case 'cmd': return spawnSync('sh', ['-c', c.cmd], { cwd: ws, timeout: 60000 }).status === (c.expectExit ?? 0);
    default: return false;
  }
}

function score(withSolution, conv) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-'));
  try {
    copy(path.join(HERE, 'fixture'), ws);
    if (withSolution) copy(path.join(HERE, 'solution'), ws, new Set(['ASKS.json']));
    const cf = path.join(ws, '..', `${path.basename(ws)}-conv.json`);
    fs.writeFileSync(cf, JSON.stringify(conv || { questions: [] }));
    const others = draft.checks.filter((c) => c.type !== 'tests').map((c) => ({ c, ok: check(ws, c) }));
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-run-'));
    copy(ws, run);
    fs.rmSync(path.join(run, 'hidden'), { recursive: true, force: true });
    copy(path.join(HERE, 'hidden'), path.join(run, 'hidden'));
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const r = spawnSync('sh', ['-c', 'node --test --test-timeout=15000 hidden/*.test.js'], { cwd: run, encoding: 'utf8', env: { ...env, BENCH_CONVERSATION: cf }, timeout: 120000 });
    fs.rmSync(run, { recursive: true, force: true });
    fs.rmSync(cf, { force: true });
    const out = `${r.stdout}\n${r.stderr}`;
    const tests = Number((/^\S*\s*(?:#|\u2139)\s+tests\s+(\d+)/m.exec(out) || [])[1] || 0);
    const pass = Number((/^\S*\s*(?:#|\u2139)\s+pass\s+(\d+)/m.exec(out) || [])[1] || 0);
    const sub = others.filter(({ c }) => c.kind !== 'format');
    const tw = sub.reduce((n, { c }) => n + (c.weight ?? 1), 0);
    const cw = sub.reduce((n, { c, ok }) => n + (ok ? c.weight ?? 1 : 0), 0);
    const h = tests ? pass / tests : 0;
    const q = ((0.5 * h + 0.2 * (tw ? cw / tw : 0)) / 0.7) * 100;
    const failed = out.split('\n').filter((l) => /^not ok|\u2716/.test(l.trim())).slice(0, 12);
    return { hidden: `${pass}/${tests}`, checks: others.map(({ c, ok }) => `${ok ? 'pass' : 'FAIL'} ${c.type} ${c.path || c.cmd || ''}`.slice(0, 140)), score: Math.round(q), failed };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

let conv = null;
if (draft.scriptedUser) {
  const asks = JSON.parse(fs.readFileSync(path.join(HERE, 'solution', 'ASKS.json'), 'utf8'));
  conv = converse(asks);
  const got = new Set(conv.questions.flatMap((q) => q.matched));
  const missing = draft.scriptedUser.facts.filter((f) => !got.has(f.id)).map((f) => f.id);
  console.log(`facts unlocked by ASKS.json: ${got.size}/${draft.scriptedUser.facts.length}${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  console.log(`questions in ASKS.json: ${conv.questions.reduce((n, q) => n + q.count, 0)} (keep it at 6 or fewer)`);
  const g = converse([GENERIC]).questions[0].matched;
  console.log(`generic ask unlocks: ${g.length ? g.join(', ') + ' (too broad, fix the topics)' : 'nothing (good)'}`);
}
for (const [name, sol, c] of [['reference', true, conv], ['stub', false, null]]) {
  const r = score(sol, c);
  console.log(`\n${name}: score ~${r.score}, hidden ${r.hidden}`);
  for (const l of r.checks) console.log(`  ${l}`);
  if (name === 'reference') for (const l of r.failed) console.log(`  failed test: ${l}`);
}
console.log('\nTargets: reference >= 95, stub <= 20.');
