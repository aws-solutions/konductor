#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of the T6 tasks (plan 4.6): no model call. For each task it checks the schema and the v3 rules,
// that the shared doc-key.js copy is current and answers.json matches scriptedUser, then scores
//   - the reference: fixture + solutions/<id>/ overlay, with the conversation the fake user gives to the reference
//     asks (solutions/<id>/ASKS.json, one string per asking turn), and requires >= 95;
//   - the stub: the untouched fixture and no conversation, and requires <= 20;
// three times each, and requires the same check results every time. Scripted tasks must have every fact unlocked by
// the reference asks, and a bare "anything else?" must unlock none. The score is code parts only (hidden 0.5,
// checks 0.2, renormalised); the rubric needs judges and is left out, as in a LITE run.
// Usage: node bench/scenarios/t6/tools/dryrun.js [--write] [--json] [id ...]
//   --write  (re)writes hidden/<id>/hidden/doc-key.js and answers.json before checking.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck } = require('../../../runner/lib/check-matcher.js');
const { checksScore, qualityOfRun } = require('../../../report/scores.js');
const { validate, loadSchema } = require('../../../runner/lib/schema.js');
const { v3Errors } = require('../../../runner/lib/task-v3.js');
const { converse, unmatchedFacts } = require('./fake-user.js');

const BATCH = path.resolve(__dirname, '..');
const KEY = path.join(__dirname, 'doc-key.js');
const WEIGHTS = { hidden: 0.5, checks: 0.2, rubric: 0.3 };
const REPEATS = 3;
const GENERIC_ASK = 'Is there anything else I should know before I start?';

function copyTree(src, dest, skip = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function applyDeletes(root, solDir) {
  const f = path.join(solDir, 'DELETE.txt');
  if (!fs.existsSync(f)) return;
  for (const rel of fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
}

/** One scoring pass: { score, hidden, checks: [{ i, type, kind, passed, detail }] }. */
function scoreOnce(task, { fixtureDir, hiddenDir, solDir, conv, scratch }) {
  const ws = fs.mkdtempSync(path.join(scratch, 'ws-'));
  try {
    copyTree(fixtureDir, ws);
    if (solDir) { copyTree(solDir, ws, new Set(['ASKS.json', 'DELETE.txt'])); applyDeletes(ws, solDir); }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    if (conv) {
      const cf = path.join(scratch, `conv-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(cf, JSON.stringify(conv));
      env.BENCH_CONVERSATION = cf;
    } else delete env.BENCH_CONVERSATION;
    const results = task.checks.map((c, i) => {
      let r;
      try { r = evalCheck(ws, c, { pristineDir: fixtureDir, hiddenDir, env, scratchDir: scratch }); } catch (e) { r = { passed: false, detail: e.message }; }
      return { i, type: c.type, kind: c.kind ?? 'substance', weight: c.weight, passed: r.passed, detail: r.detail, tests: r.tests };
    });
    const t = results.find((r) => r.type === 'tests' && r.tests);
    const hidden = t ? t.tests.passed / Math.max(1, t.tests.total) : null;
    const q = qualityOfRun({ hidden, checks: checksScore(results, WEIGHTS) }, WEIGHTS);
    return { score: q ? Math.round(q.score * 10) / 10 : null, hidden: t ? `${t.tests.passed}/${t.tests.total}` : null, checks: results };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

const signature = (r) => `${r.score}|${r.hidden}|${r.checks.map((c) => (c.passed ? 1 : 0)).join('')}`;

function keyCopies(task, hiddenDir, write) {
  const errs = [];
  const inner = path.join(hiddenDir, 'hidden');
  if (!fs.existsSync(inner)) return [`hidden/${task.hidden}/hidden is missing`];
  const keyCopy = path.join(inner, 'doc-key.js');
  const answers = path.join(inner, 'answers.json');
  if (write) {
    fs.copyFileSync(KEY, keyCopy);
    if (task.scriptedUser) fs.writeFileSync(answers, `${JSON.stringify(task.scriptedUser.facts.map((f) => f.answer), null, 2)}\n`);
  }
  if (!fs.existsSync(keyCopy) || fs.readFileSync(keyCopy, 'utf8') !== fs.readFileSync(KEY, 'utf8')) errs.push('hidden doc-key.js differs from tools/doc-key.js (run with --write)');
  if (task.scriptedUser) {
    const want = JSON.stringify(task.scriptedUser.facts.map((f) => f.answer));
    let got = null;
    try { got = JSON.stringify(JSON.parse(fs.readFileSync(answers, 'utf8'))); } catch { /* missing */ }
    if (got !== want) errs.push('hidden answers.json does not match scriptedUser (run with --write)');
  }
  return errs;
}

function dryRun(task, opts) {
  const errors = [];
  const schemaErrs = validate(loadSchema('task'), task);
  for (const e of schemaErrs) errors.push(`schema: ${typeof e === 'string' ? e : JSON.stringify(e)}`);
  for (const e of v3Errors(task)) errors.push(`v3: ${e}`);
  const fixtureDir = path.join(BATCH, 'fixtures', task.fixture);
  const hiddenDir = path.join(BATCH, 'hidden', task.hidden ?? task.id);
  const solDir = path.join(BATCH, 'solutions', task.id);
  for (const [d, n] of [[fixtureDir, 'fixture'], [solDir, 'solution']]) if (!fs.existsSync(d)) errors.push(`${n} missing: ${path.relative(BATCH, d)}`);
  if (task.hidden) errors.push(...keyCopies(task, hiddenDir, opts.write));
  if (errors.some((e) => /missing/.test(e))) return { id: task.id, errors };

  let refConv = null;
  let stubConv = null;
  const facts = {};
  if (task.scriptedUser) {
    const asksFile = path.join(solDir, 'ASKS.json');
    const asks = fs.existsSync(asksFile) ? JSON.parse(fs.readFileSync(asksFile, 'utf8')) : [];
    if (!asks.length) errors.push('scripted task needs solutions/<id>/ASKS.json with the reference asks');
    refConv = converse(task, asks);
    facts.unlockedByReference = task.scriptedUser.facts.length - unmatchedFacts(task, refConv).length;
    facts.total = task.scriptedUser.facts.length;
    const missing = unmatchedFacts(task, refConv);
    if (missing.length) errors.push(`reference asks do not unlock: ${missing.join(', ')}`);
    const generic = converse(task, [GENERIC_ASK]).questions[0];
    if (generic.matched.length) errors.push(`a generic ask unlocks ${generic.matched.join(', ')}; topics are too broad`);
    stubConv = { questions: [] };
    const leaked = task.scriptedUser.facts.filter((f) => f.topics.length && new RegExp(`\\b${f.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}`, 'i').test(task.prompt));
    if (leaked.length) errors.push(`prompt repeats a fact answer: ${leaked.map((f) => f.id).join(', ')}`);
  }

  const scratch = fs.mkdtempSync(path.join(opts.tmp, `t6-${task.id}-`));
  try {
    const ref = [];
    const stub = [];
    for (let k = 0; k < REPEATS; k++) {
      ref.push(scoreOnce(task, { fixtureDir, hiddenDir, solDir, conv: refConv, scratch }));
      stub.push(scoreOnce(task, { fixtureDir, hiddenDir, solDir: null, conv: stubConv, scratch }));
    }
    const deterministic = new Set(ref.map(signature)).size === 1 && new Set(stub.map(signature)).size === 1;
    if (!deterministic) errors.push('check results differ across repeats');
    if (!(ref[0].score >= 95)) errors.push(`reference scores ${ref[0].score} (< 95): ${ref[0].checks.filter((c) => !c.passed).map((c) => `#${c.i} ${c.type} ${c.detail}`).join('; ')}`);
    if (!(stub[0].score <= 20)) errors.push(`stub scores ${stub[0].score} (> 20): passing ${stub[0].checks.filter((c) => c.passed).map((c) => `#${c.i} ${c.type}`).join(', ')}`);
    return { id: task.id, errors, reference: ref[0].score, referenceHidden: ref[0].hidden, stub: stub[0].score, stubHidden: stub[0].hidden, deterministic, facts, failingRef: ref[0].checks.filter((c) => !c.passed).map((c) => `#${c.i} ${c.type}: ${c.detail}`) };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const json = args.includes('--json');
  const ids = args.filter((a) => !a.startsWith('--'));
  const files = fs.readdirSync(BATCH).filter((f) => f.endsWith('.json')).sort();
  const tasks = files.map((f) => JSON.parse(fs.readFileSync(path.join(BATCH, f), 'utf8'))).filter((t) => typeof t.prompt === 'string' && (!ids.length || ids.includes(t.id)));
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 't6-dryrun-'));
  try {
    const out = tasks.map((t) => dryRun(t, { write, tmp }));
    if (json) console.log(JSON.stringify(out, null, 2));
    else for (const r of out) console.log(`${r.errors.length ? 'FAIL' : 'ok  '} ${r.id}: reference ${r.reference} (${r.referenceHidden}), stub ${r.stub} (${r.stubHidden})${r.facts?.total ? `, facts ${r.facts.unlockedByReference}/${r.facts.total}` : ''}${r.errors.length ? `\n     ${r.errors.join('\n     ')}` : ''}`);
    if (out.some((r) => r.errors.length)) process.exitCode = 1;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (require.main === module) main();
module.exports = { dryRun, scoreOnce };
