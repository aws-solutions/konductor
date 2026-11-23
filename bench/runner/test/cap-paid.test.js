// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paid keep-or-prune path, tested free on a fake kiro-cli (fake-kp-kiro.js): the spend-checked call (paidcall.js),
// writing a unit baseline with the one-fix rule (unitauthor.js), the paid quick stage run (kiroprovider.js through
// runUnitStage), and the two owner scripts in bench/cap/pilot on their paid path. No model, no network, no spend.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { paidCall, paidJson, ledgerSpent, assertOutsideHome, PaidCallRefused } = require('../../cap/paidcall.js');
const { authorUnit } = require('../../cap/unitauthor.js');
const { runUnitStage, loadUnitBaseline, PILOT_JUDGES } = require('../../cap/unitstage.js');
const { unitManifest } = require('../../cap/units.js');

const FAKE = path.join(__dirname, 'fake-kp-kiro.js');
// A paid call gets only the env allowlist; the fake's own switches are let through by name.
process.env.BENCH_PAID_ENV_KEEP = ['LOG', 'CREDITS', 'FAIL', 'NOFIX', 'BROKEN', 'BROKEN_FIRST', 'COUNTER', 'UNFINISHED', 'SEE_LEDGER', 'NO_ORACLE', 'TITLE_CASE'].map((n) => `FAKE_KP_${n}`).join(',');
const BENCH = path.join(__dirname, '..', '..');
const REPO = path.join(BENCH, '..');
const spec = (name, contexts = []) => JSON.stringify({ name, config: { description: `${name} desc`, systemPrompt: `You are ${name}.` },
  dependencies: { skills: { skillNames: [] }, agentSops: { agentSopNames: [] }, context: { contextNames: contexts }, subagents: { agentNames: [] } } });

/** A scratch tree: a repo with one listed context file, a work dir, a fake sign-in db, and a log of fake calls. */
function rig() {
  const root = tmp();
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'agents', 'konductor.agent-spec.json'), spec('konductor', ['k-rules.md']));
  write(path.join(repo, 'context', 'k-rules.md'), '# Rules\n\nHand a third note in a row back to the user.\n');
  const authDb = path.join(root, 'auth.sqlite3');
  write(authDb, 'fake');
  const log = path.join(root, 'calls.log');
  const paid = { cap: 1000, ledger: path.join(root, 'ledger.jsonl'), workDir: path.join(root, 'work'), bin: FAKE, authDb };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return { root, repo, paid, log, calls, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Runs `fn` with the fake's env set, then puts the env back. */
function withEnv(env, fn) {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('a paid call counts at the larger of 15 and its real credits, resumes free, and is refused before the cap', () => {
  const r = rig();
  try {
    withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_CREDITS: '0.5' }, () => {
      const a = paidCall({ ...r.paid, model: 'glm-5', prompt: 'hello', out: path.join(r.root, 'out', 'a') });
      assert.equal(a.counted, 15);
      assert.equal(a.real, 0.5);
      assert.equal(paidCall({ ...r.paid, model: 'glm-5', prompt: 'hello', out: path.join(r.root, 'out', 'a') }).resumed, true);
      assert.equal(r.calls().length, 1, 'the rerun read the saved reply back');
      const [, , home] = r.calls()[0].split(' ');
      assert.ok(home.startsWith(r.paid.workDir), 'the call ran in a scratch HOME under the work dir');
      assert.equal(fs.existsSync(home), false, 'and the scratch HOME is gone');
    });
    withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_CREDITS: '20' }, () => {
      assert.equal(paidCall({ ...r.paid, model: 'glm-5', prompt: 'big', out: path.join(r.root, 'out', 'b') }).counted, 20);
    });
    assert.equal(ledgerSpent(r.paid.ledger), 35);
    const out = path.join(r.root, 'out', 'c');
    assert.throws(() => paidCall({ ...r.paid, cap: 49, model: 'glm-5', prompt: 'more', out }), PaidCallRefused);
    assert.match(fs.readFileSync(`${out}.refused`, 'utf8'), /spent 35 \+ worst 15 would pass the cap 49/);
    assert.equal(r.calls().length, 2, 'a refused call never starts kiro-cli');
  } finally { r.cleanup(); }
});

test('a call that never finished is counted at 15 and leaves nothing to resume; an unreadable reply is moved aside', () => {
  const r = rig();
  try {
    const out = path.join(r.root, 'out', 'u');
    withEnv({ FAKE_KP_UNFINISHED: '1' }, () => assert.throws(() => paidCall({ ...r.paid, model: 'glm-5', prompt: 'x', out }), /no finished reply.*counted 15/));
    assert.equal(fs.existsSync(`${out}.json`), false);
    assert.equal(ledgerSpent(r.paid.ledger), 15);
    const bad = path.join(r.root, 'out', 'bad');
    assert.throws(() => paidJson({ ...r.paid, model: 'glm-5', prompt: 'Write exactly 2 checklist items', out: bad }, (j) => { if (!j.nope) throw new Error('no nope'); }), /could not be read.*bad-1\.json/);
    assert.ok(fs.existsSync(`${bad}.bad-1.json`));
    assert.equal(fs.existsSync(`${bad}.json`), false, 'a rerun asks again');
  } finally { r.cleanup(); }
});

test('work dirs must be absolute and outside the home folder', () => {
  assert.throws(() => assertOutsideHome(path.join(os.homedir(), 'kp-work')), /outside/);
  assert.throws(() => assertOutsideHome('relative/dir'), /outside/);
  assert.doesNotThrow(() => assertOutsideHome('/var/tmp/konductor-kp-pilot'));
});

/** 16 briefs in two batches for the rig's unit. */
function briefsFile(r) {
  const file = path.join(r.root, 'briefs.json');
  const briefs = Array.from({ length: 16 }, (_, i) => ({ id: `t${String(i + 1).padStart(2, '0')}`, batch: i < 8 ? 'b1' : 'b2', section: 'Handoffs', situation: `case ${i + 1}`, good: 'asks the user' }));
  write(file, JSON.stringify({ unit: 'context:k-rules', briefs }));
  return file;
}

test('writing a baseline: two families, one fix, then a still failing task is dropped and recorded; reruns resume', () => {
  const r = rig();
  try {
    const out = path.join(r.root, 'baseline', 'baseline.json');
    const args = { kind: 'context', name: 'k-rules', repo: r.repo, briefsFile: briefsFile(r), out, paid: r.paid };
    const plan = authorUnit({ ...args, dryRun: true });
    assert.equal(plan.plan.length, 8);
    assert.equal(plan.worst, 120);
    assert.equal(r.calls().length, 0, 'the dry run made no call');

    const ok = withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_FAIL: 't03,t12' }, () => authorUnit(args));
    assert.equal(ok.status, 'frozen');
    assert.deepEqual(r.calls().map((l) => l.split(' ').slice(0, 2).join(' ')), [1, 2].flatMap(() => ['glm-5 write', 'deepseek-3.2 review', 'glm-5 fix', 'deepseek-3.2 review']), 'per batch: write, review, one fix, recheck');
    const b = loadUnitBaseline(out);
    assert.equal(b.unit_sha256, unitManifest({ repo: r.repo, kind: 'context', name: 'k-rules' }).sha256);
    assert.deepEqual(b.source.fixed, ['t03', 't12']);
    assert.match(b.source.commit, /^[0-9a-f]{40}$/, 'the baseline names the bench commit that wrote it');
    assert.match(b.batches[0].tasks[2].prompt, / FIXED$/);
    assert.equal(withEnv({ FAKE_KP_LOG: r.log }, () => authorUnit(args)).status, 'frozen');
    assert.equal(r.calls().length, 8, 'a rerun reads every step back');
    assert.equal(ledgerSpent(r.paid.ledger), 120);
    const signed = { ...b, source: { ...b.source, signedOffBy: 'owner' } };
    fs.writeFileSync(out, JSON.stringify(signed));
    assert.throws(() => authorUnit(args), /already signed off/, 'a rerun never overwrites a sign-off');
  } finally { r.cleanup(); }
});

test('a task the fix does not save is dropped: a draft and the drop are written, never a frozen baseline', () => {
  const r = rig();
  try {
    const out = path.join(r.root, 'baseline', 'baseline.json');
    const res = withEnv({ FAKE_KP_FAIL: 't05', FAKE_KP_NOFIX: 't05' }, () => authorUnit({ kind: 'context', name: 'k-rules', repo: r.repo, briefsFile: briefsFile(r), out, paid: r.paid }));
    assert.equal(res.status, 'dropped');
    assert.equal(fs.existsSync(out), false);
    const draft = JSON.parse(fs.readFileSync(res.file, 'utf8'));
    assert.deepEqual(draft.source.dropped.map((d) => d.id), ['t05']);
    assert.equal(draft.batches[0].tasks.length, 7);
  } finally { r.cleanup(); }
});

test('a dropped task: option B replaces it (other family writes, first family reviews, two calls), and the freeze step signs the draft off', () => {
  const { replaceDropped, freezeDraft } = require('../../cap/unitauthor.js');
  const r = rig();
  try {
    const out = path.join(r.root, 'baseline', 'baseline.json');
    const draftFile = path.join(r.root, 'baseline', 'baseline.draft.json');
    const args = { kind: 'context', name: 'k-rules', repo: r.repo, briefsFile: briefsFile(r), out, paid: r.paid };
    withEnv({ FAKE_KP_FAIL: 't05', FAKE_KP_NOFIX: 't05' }, () => authorUnit(args));
    const spent = ledgerSpent(r.paid.ledger);
    // The free freeze works on the 15-task draft too.
    const copy = path.join(r.root, 'fifteen', 'baseline.json');
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    assert.throws(() => freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile, out: copy, signedOffBy: ' ' }), /needs the name/);
    assert.equal(freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile, out: copy, signedOffBy: 'owner' }), 15);
    assert.equal(loadUnitBaseline(copy).source.signedOffBy, 'owner');
    assert.throws(() => freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile, out: copy, signedOffBy: 'owner' }), /already exists/);
    // Option B: the plan is two calls, 30 counted, and makes no call.
    const plan = replaceDropped({ ...args, draftFile, id: 't05', dryRun: true });
    assert.deepEqual(plan.plan.map((p) => [p.step, p.model]), [['t05.replace', 'deepseek-3.2'], ['t05.replace-review', 'glm-5']]);
    assert.equal(plan.worst, 30);
    assert.equal(ledgerSpent(r.paid.ledger), spent);
    const res = withEnv({ FAKE_KP_LOG: r.log }, () => replaceDropped({ ...args, draftFile, id: 't05' }));
    assert.equal(res.status, 'replaced');
    assert.deepEqual(r.calls().map((l) => l.split(' ').slice(0, 2).join(' ')), ['deepseek-3.2 write', 'glm-5 review']);
    assert.equal(ledgerSpent(r.paid.ledger), spent + 30);
    const d = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
    assert.deepEqual(d.source.dropped, []);
    assert.deepEqual(d.source.replaced.map((x) => [x.id, x.writtenBy, x.reviewedBy, x.verdict]), [['t05', 'deepseek-3.2', 'glm-5', 'pass']]);
    assert.deepEqual(d.batches[0].tasks.map((t) => t.id), ['t01', 't02', 't03', 't04', 't05', 't06', 't07', 't08']);
    assert.equal(freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile, out, signedOffBy: 'owner' }), 16);
    assert.throws(() => replaceDropped({ ...args, draftFile, id: 't05' }), /not in source.dropped/);
  } finally { r.cleanup(); }
});

test('a replacement that fails its review stays dropped, with the failure recorded; it gets no fix', () => {
  const { replaceDropped } = require('../../cap/unitauthor.js');
  const r = rig();
  try {
    const out = path.join(r.root, 'baseline', 'baseline.json');
    const draftFile = path.join(r.root, 'baseline', 'baseline.draft.json');
    const args = { kind: 'context', name: 'k-rules', repo: r.repo, briefsFile: briefsFile(r), out, paid: r.paid };
    withEnv({ FAKE_KP_FAIL: 't05', FAKE_KP_NOFIX: 't05' }, () => authorUnit(args));
    const res = withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_FAIL: 't05' }, () => replaceDropped({ ...args, draftFile, id: 't05' }));
    assert.equal(res.status, 'still dropped');
    assert.equal(r.calls().length, 2, 'two calls, no fix');
    const d = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
    assert.match(d.source.dropped[0].note, /the replacement by deepseek-3.2 also failed review by glm-5/);
    assert.equal(d.batches[0].tasks.length, 7);
  } finally { r.cleanup(); }
});

test('a rewrite: a new baseline version with the named tasks written again and every other task copied byte for byte', () => {
  const { rewriteUnit, freezeDraft } = require('../../cap/unitauthor.js');
  const r = rig();
  try {
    // A 15-task frozen baseline (t14 dropped), signed off, as the pilot's.
    const v1 = path.join(r.root, 'v1', 'baseline.json');
    const args = { kind: 'context', name: 'k-rules', repo: r.repo, briefsFile: briefsFile(r), out: v1, paid: { ...r.paid, workDir: path.join(r.root, 'work1') } };
    withEnv({ FAKE_KP_FAIL: 't14', FAKE_KP_NOFIX: 't14' }, () => authorUnit(args));
    freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile: v1.replace(/\.json$/, '.draft.json'), out: v1, signedOffBy: 'owner' });
    const before = fs.readFileSync(v1, 'utf8');
    const spent = ledgerSpent(r.paid.ledger);
    const rewriteFile = path.join(r.root, 'rewrite.json');
    const ids = ['t01', 't07', 't09', 't12', 't16'];
    write(rewriteFile, JSON.stringify({ unit: 'context:k-rules', families: { writer: 'deepseek-3.2', reviewer: 'glm-5' }, review: 'test review',
      tasks: ids.map((id) => ({ id, batch: Number(id.slice(1)) <= 8 ? 'b1' : 'b2', section: 'Handoffs', situation: `new case ${id}`, good: 'asks the user', why: ['it hid the note'] })) }));
    const v2 = path.join(r.root, 'v2', 'baseline.json');
    const rw = { kind: 'context', name: 'k-rules', repo: r.repo, rewriteFile, fromFile: v1, out: v2, paid: { ...r.paid, workDir: path.join(r.root, 'work2') } };

    const plan = rewriteUnit({ ...rw, dryRun: true });
    assert.deepEqual(plan.plan.map((p) => [p.step, p.model]), [['write', 'deepseek-3.2'], ['review', 'glm-5'], ['fix', 'deepseek-3.2'], ['recheck', 'glm-5']]);
    assert.equal(plan.worst, 60);
    assert.deepEqual(plan.kept, ['t02', 't03', 't04', 't05', 't06', 't08', 't10', 't11', 't13', 't15']);
    assert.equal(r.calls().length, 0, 'the dry run made no call');

    const res = withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_FAIL: 't09' }, () => rewriteUnit(rw));
    assert.equal(res.status, 'frozen');
    assert.deepEqual(r.calls().map((l) => l.split(' ').slice(0, 2).join(' ')), ['deepseek-3.2 write', 'glm-5 review', 'deepseek-3.2 fix', 'glm-5 review']);
    assert.equal(ledgerSpent(r.paid.ledger), spent + 60);
    assert.equal(fs.readFileSync(v1, 'utf8'), before, 'the baseline it came from is never changed');
    const old = JSON.parse(before);
    const b = loadUnitBaseline(v2);
    const tasksOf = (x) => new Map(x.batches.flatMap((bt) => bt.tasks.map((t) => [t.id, t])));
    const [o, n] = [tasksOf(old), tasksOf(b)];
    assert.equal(n.size, 15);
    for (const id of plan.kept) assert.equal(JSON.stringify(n.get(id), null, 2), JSON.stringify(o.get(id), null, 2), `${id} is copied byte for byte`);
    for (const id of ids) assert.notEqual(n.get(id).prompt, o.get(id).prompt, `${id} is rewritten`);
    assert.deepEqual(b.batches.map((bt) => bt.tasks.map((t) => t.id)), old.batches.map((bt) => bt.tasks.map((t) => t.id)), 'every task keeps its place');
    assert.equal(b.source.signedOffBy, null, 'the new version has no sign-off');
    assert.equal(b.source.version, 2);
    assert.equal(b.source.from.signedOffBy, 'owner');
    assert.deepEqual(b.source.fixed, ['t09']);
    assert.deepEqual(b.source.dropped.map((d) => d.id), ['t14'], 'the earlier drop stays recorded');
    // The writer and the reviewer saw the earlier task and why it was bad.
    const { writePrompt, reviewPrompt } = require('../../cap/unitauthor.js');
    const frame = { noun: 'context file', tasks: '' };
    const brief = [{ id: 't01', section: 'Handoffs', situation: 's', good: 'g' }];
    assert.match(writePrompt(frame, 'U', brief, ['earlier: it hid the note']), /earlier: it hid the note\n\nBriefs:/);
    assert.match(reviewPrompt(frame, 'U', brief, [], ['earlier: it hid the note']), /it hid the note[\s\S]*Tasks:/);
    // A rerun reads the steps back; a rewrite that still fails is dropped; the unit must match; --out is a new file.
    withEnv({ FAKE_KP_LOG: r.log }, () => rewriteUnit(rw));
    assert.equal(r.calls().length, 4);
    const v3 = path.join(r.root, 'v3', 'baseline.json');
    const drop = withEnv({ FAKE_KP_FAIL: 't12', FAKE_KP_NOFIX: 't12' }, () => rewriteUnit({ ...rw, out: v3, paid: { ...r.paid, workDir: path.join(r.root, 'work3') } }));
    assert.equal(drop.status, 'dropped');
    const d = JSON.parse(fs.readFileSync(drop.file, 'utf8'));
    assert.deepEqual(d.source.dropped.map((x) => x.id), ['t14', 't12']);
    assert.equal(d.batches[1].tasks.length, 6);
    assert.throws(() => rewriteUnit({ ...rw, out: v1, dryRun: true }), /new file/);
    fs.appendFileSync(path.join(r.repo, 'context', 'k-rules.md'), 'One more line.\n');
    assert.throws(() => rewriteUnit({ ...rw, dryRun: true }), /another version/);
  } finally { r.cleanup(); }
});

test('a redo of one rewritten task: one last try with no fix, same version; a fail drops it, and 14 tasks still run', { timeout: 600000 }, () => {
  const { rewriteUnit, freezeDraft } = require('../../cap/unitauthor.js');
  const r = rig();
  try {
    // v1 (t14 dropped, signed off), then v2 with five rewrites, unsigned: the state after the first rewrite.
    const v1 = path.join(r.root, 'v1', 'baseline.json');
    withEnv({ FAKE_KP_FAIL: 't14', FAKE_KP_NOFIX: 't14' }, () => authorUnit({ kind: 'context', name: 'k-rules', repo: r.repo, briefsFile: briefsFile(r), out: v1, paid: { ...r.paid, workDir: path.join(r.root, 'w1') } }));
    freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile: v1.replace(/\.json$/, '.draft.json'), out: v1, signedOffBy: 'owner' });
    const brief = (id, extra = {}) => ({ id, batch: Number(id.slice(1)) <= 8 ? 'b1' : 'b2', section: 'Denials', situation: `new case ${id}`, good: 'asks the user', why: ['user voice'], ...extra });
    const rw1 = path.join(r.root, 'rw1.json');
    write(rw1, JSON.stringify({ unit: 'context:k-rules', families: { writer: 'deepseek-3.2', reviewer: 'glm-5' }, tasks: ['t01', 't07', 't09', 't12', 't16'].map((id) => brief(id)) }));
    const work = path.join(r.root, 'w2');
    const v2dir = path.join(r.root, 'v2', 'context-k-rules');
    const v2 = path.join(v2dir, 'baseline.json');
    rewriteUnit({ kind: 'context', name: 'k-rules', repo: r.repo, rewriteFile: rw1, fromFile: v1, out: v2, paid: { ...r.paid, workDir: work } });
    const before = path.join(v2dir, 'baseline.before-redo-t09.json');
    fs.renameSync(v2, before);
    // The redo: its own step name in the same work dir, no fix.
    const redoFile = path.join(r.root, 'redo.json');
    write(redoFile, JSON.stringify({ unit: 'context:k-rules', name: 'redo-t09', noFix: true, families: { writer: 'deepseek-3.2', reviewer: 'glm-5' }, review: 'Fable v2 review', tasks: [brief('t09', { why: ['still the user asking "What do I do next?"'] })] }));
    const redo = { kind: 'context', name: 'k-rules', repo: r.repo, rewriteFile: redoFile, fromFile: before, out: v2, paid: { ...r.paid, workDir: work } };
    const plan = rewriteUnit({ ...redo, dryRun: true });
    assert.deepEqual(plan.plan.map((p) => [p.batch, p.step, p.model, p.done]), [['redo-t09', 'write', 'deepseek-3.2', false], ['redo-t09', 'review', 'glm-5', false]], 'two calls, not the first rewrite\'s saved steps');
    assert.equal(plan.worst, 30);
    // It fails its review: dropped, no fix call, a draft of 14 tasks, the same version.
    const n0 = r.calls().length;
    const res = withEnv({ FAKE_KP_LOG: r.log, FAKE_KP_FAIL: 't09' }, () => rewriteUnit(redo));
    assert.equal(res.status, 'dropped');
    assert.deepEqual(r.calls().slice(n0).map((l) => l.split(' ').slice(0, 2).join(' ')), ['deepseek-3.2 write', 'glm-5 review']);
    const d = JSON.parse(fs.readFileSync(res.file, 'utf8'));
    assert.equal(d.source.version, 2, 'a redo of an unsigned version stays that version');
    assert.equal(d.source.from.signedOffBy, 'owner', 'it still names v1');
    assert.deepEqual(d.source.kept, ['t02', 't03', 't04', 't05', 't06', 't08', 't10', 't11', 't13', 't15']);
    assert.deepEqual(d.source.rewritten, ['t01', 't07', 't12', 't16']);
    assert.deepEqual(d.source.dropped.map((x) => x.id), ['t14', 't09']);
    assert.deepEqual(d.source.redone.map((x) => [x.rewrite, x.noFix, x.dropped]), [['redo.json', true, ['t09']]]);
    const old = JSON.parse(fs.readFileSync(before, 'utf8'));
    const same = (id) => JSON.stringify(d.batches.flatMap((b) => b.tasks).find((t) => t.id === id)) === JSON.stringify(old.batches.flatMap((b) => b.tasks).find((t) => t.id === id));
    assert.ok(['t01', 't02', 't07', 't12', 't16'].every(same), 'every other task is unchanged');
    // 14 tasks freeze and run: the floor is 11 of 14 (12 of 16, rounded up).
    assert.equal(freezeDraft({ kind: 'context', name: 'k-rules', repo: r.repo, draftFile: res.file, out: v2, signedOffBy: 'owner' }), 14);
    const { record } = withEnv({ FAKE_KP_LOG: r.log }, () => runUnitStage({ kind: 'context', name: 'k-rules', repo: r.repo, runId: 'kp-14', outDir: path.join(r.root, 'runs'), provider: 'kiro', depths: ['quick'], subjectModel: 'claude-sonnet-5.5', judges: [...PILOT_JUDGES], baselinesDir: path.dirname(v2dir), paid: { ...r.paid, cap: 100000 }, roleLine: true }));
    assert.equal(record.quick.coverage.tasksTotal, 14);
    assert.equal(record.quick.coverage.tasksCounted, 14);
    assert.deepEqual(record.baseline.source.dropped.map((x) => x.id), ['t14', 't09']);
  } finally { r.cleanup(); }
});

/** A frozen baseline for the rig's unit, so its stage can run; `signedOffBy` null leaves it unsigned. */
function freeze(r, signedOffBy = 'test owner') {
  const dir = path.join(r.root, 'unit-baselines');
  const tasks = (batch) => Array.from({ length: 8 }, (_, i) => ({ id: `${batch}-${i}`, prompt: `Third note in a row ${batch} ${i}: what next?`, rubric: ['The answer stops.', 'The answer asks the user.'] }));
  write(path.join(dir, 'context-k-rules', 'baseline.json'), JSON.stringify({ format_version: 1, kind: 'context', name: 'k-rules', unit_sha256: unitManifest({ repo: r.repo, kind: 'context', name: 'k-rules' }).sha256,
    source: { writtenBy: 'test', signedOffBy }, batches: [{ batch: 'b1', tasks: tasks('b1') }, { batch: 'b2', tasks: tasks('b2') }] }));
  return dir;
}

test('the paid stage refuses before any call: a stub run id, a deep depth, a short panel, no cap, or no baseline', () => {
  const r = rig();
  try {
    const base = { kind: 'context', name: 'k-rules', repo: r.repo, outDir: path.join(r.root, 'runs'), provider: 'kiro', paid: r.paid, depths: ['quick'], subjectModel: 'claude-sonnet-5.5', judges: [...PILOT_JUDGES] };
    withEnv({ FAKE_KP_LOG: r.log }, () => {
      assert.throws(() => runUnitStage({ ...base, runId: 'stub-1', baselinesDir: freeze(r) }), /not a stub one/);
      assert.throws(() => runUnitStage({ ...base, runId: 'p1', depths: ['quick', 'deep'], baselinesDir: freeze(r) }), /quick depth only/);
      assert.throws(() => runUnitStage({ ...base, runId: 'p1', judges: ['qwen3-coder-next', 'claude-opus-5.5'], baselinesDir: freeze(r) }), /not enough judge families/);
      assert.throws(() => runUnitStage({ ...base, runId: 'p1', paid: { ...r.paid, cap: NaN }, baselinesDir: freeze(r) }), /--cap/);
      assert.throws(() => runUnitStage({ ...base, runId: 'p1', baselinesDir: path.join(r.root, 'none') }), /no paid call made.*no frozen baseline/);
      assert.throws(() => runUnitStage({ ...base, runId: 'p1', baselinesDir: freeze(r, null) }), /no paid call made.*not signed off/);
    });
    assert.equal(r.calls().length, 0);
  } finally { r.cleanup(); }
});

test('the paid quick stage runs keep against drop through the real pipeline, stops at the cap, and resumes', { timeout: 600000 }, () => {
  const r = rig();
  try {
    const baselinesDir = freeze(r);
    const outDir = path.join(r.root, 'runs');
    const base = { kind: 'context', name: 'k-rules', repo: r.repo, runId: 'kp-test', outDir, provider: 'kiro', depths: ['quick'], subjectModel: 'claude-sonnet-5.5', judges: [...PILOT_JUDGES], baselinesDir };
    withEnv({ FAKE_KP_LOG: r.log }, () => assert.throws(() => runUnitStage({ ...base, paid: { ...r.paid, cap: 45 } }), PaidCallRefused));
    assert.equal(r.calls().length, 3, 'three calls fit a 45 credit cap at 15 each');
    const { record } = withEnv({ FAKE_KP_LOG: r.log }, () => runUnitStage({ ...base, paid: { ...r.paid, cap: 100000 } }));
    const made = r.calls().length;
    assert.equal(ledgerSpent(r.paid.ledger), made * 15);
    assert.equal(record.deep, null);
    assert.equal(record.quick.provider, 'kiro');
    assert.equal(record.quick.coverage.tasksTotal, 16);
    assert.deepEqual(record.quick.judges.map((j) => j.model), [...PILOT_JUDGES]);
    assert.equal(record.quick.controls.passed, true, 'the convention control and the dose ladder pass on the fake');
    assert.equal(record.quick.coverage.tasksCounted, 16);
    assert.ok(record.quick.gapB.mean > 0, 'the fake judges score the keep arm above the drop arm on the rubric');
    assert.match(record.quick.commit, /^[0-9a-f]{40}$/, 'the record names the bench commit that spent the credits');
    assert.match(record.claim, /paid run kp-test, quick depth/);
    const answers = r.calls().filter((l) => l.split(' ')[1] === 'answer');
    assert.ok(answers.every((l) => l.startsWith('claude-sonnet-5.5 ')), 'only the agent answers');
    withEnv({ FAKE_KP_LOG: r.log }, () => runUnitStage({ ...base, paid: { ...r.paid, cap: 100000 } }));
    assert.equal(r.calls().length, made, 'a rerun of the same run id makes no call');
  } finally { r.cleanup(); }
});

/** One paid quick stage run of the rig's unit on the fake, with the fake's `env`. Returns { record, calls }. */
function paidStage(r, env = {}) {
  const base = { kind: 'context', name: 'k-rules', repo: r.repo, runId: 'kp-test', outDir: path.join(r.root, 'runs'), provider: 'kiro', depths: ['quick'], subjectModel: 'claude-sonnet-5.5', judges: [...PILOT_JUDGES], baselinesDir: freeze(r), paid: { ...r.paid, cap: 100000 } };
  const { record } = withEnv({ FAKE_KP_LOG: r.log, ...env }, () => runUnitStage(base));
  return { record, calls: r.calls() };
}

test('FW-36 role line: both arms of a unit task start with it, a control prompt never does', () => {
  const { answerPrompt } = require('../../cap/kiroprovider.js');
  const unit = { name: 'k-rules', text: 'U', role: 'You orchestrate a team of specialist agents.' };
  const keep = answerPrompt('Follow it.', unit, 'with', 'Q?');
  const drop = answerPrompt('Follow it.', unit, 'without', 'Q?');
  assert.equal(keep.loaded, true);
  assert.equal(drop.loaded, false);
  assert.equal(drop.prompt, 'You orchestrate a team of specialist agents.\n\nQ?');
  assert.match(keep.prompt, /^You orchestrate a team of specialist agents\.\n\nFollow it\.\n<<<FILE\nU\nFILE>>>\n\nQ\?$/);
  const control = { name: 'convention-control', text: 'C' };
  assert.equal(answerPrompt('Follow it.', control, 'without', 'Q?').prompt, 'Q?', 'a control skill has no role');
  assert.equal(answerPrompt('Follow it.', { ...unit, role: undefined }, 'without', 'Q?').prompt, 'Q?', 'without the role line nothing changes');
});

test('FW-36 role line on a paid rerun: every unit answer is new, the controls are all cached, the record names the line', { timeout: 600000 }, () => {
  const r = rig();
  try {
    const baselinesDir = freeze(r);
    const outDir = path.join(r.root, 'runs');
    const base = { kind: 'context', name: 'k-rules', repo: r.repo, outDir, provider: 'kiro', depths: ['quick'], subjectModel: 'claude-sonnet-5.5', judges: [...PILOT_JUDGES], baselinesDir, paid: { ...r.paid, cap: 100000 } };
    withEnv({ FAKE_KP_LOG: r.log }, () => runUnitStage({ ...base, runId: 'kp-a' }));
    // A new run id with the first run's saved calls, as the owner's rerun copies them.
    fs.cpSync(path.join(outDir, 'kp-a', 'calls'), path.join(outDir, 'kp-b', 'calls'), { recursive: true });
    const { planUnitCalls } = require('../../cap/unitstage.js');
    const plan = planUnitCalls({ kind: 'context', name: 'k-rules', repo: r.repo, runId: 'kp-b', outDir, baselinesDir, roleLine: true });
    assert.equal(plan.convention.new, 0, 'the convention control stays cached');
    assert.equal(plan.ladder.new, 0, 'the dose ladder stays cached');
    assert.equal(plan.unit.cached, 16, 'only the request-only checklists stay cached');
    const before = r.calls().length;
    const { record } = withEnv({ FAKE_KP_LOG: r.log }, () => runUnitStage({ ...base, runId: 'kp-b', roleLine: true }));
    const made = r.calls().slice(before).map((l) => l.split(' ')[1]);
    assert.equal(made.filter((k) => k === 'answer').length, 32, 'both arms of all 16 unit tasks answer again');
    assert.equal(made.filter((k) => k === 'checklist').length, 0);
    // The plan counts every unit answer and judge call as new (a new answer means new judge prompts): 32 + 16 x 2 x 3 x 2.
    assert.equal(plan.unit.new, 224);
    // The fake answers the same text whatever the prompt, so its judge calls hit the cache; a real model's would not.
    assert.ok(made.length <= plan.unit.new, 'the run never makes more calls than the plan counted');
    assert.match(record.claim, /both arms of each unit task start with the role line "You orchestrate a team of specialist agents\."/);
    assert.equal(record.quick.controls.passed, true);
  } finally { r.cleanup(); }
});

test('a failed control stops the paid run before the unit: none of its answers or judgments are paid for', { timeout: 600000 }, () => {
  const r = rig();
  try {
    const { record, calls } = paidStage(r, { FAKE_KP_NO_ORACLE: '1' });
    assert.equal(record.quick.controls.passed, false);
    assert.ok(record.quick.noData.some((w) => /a control did not pass .*the unit was not run, so its calls were not spent/.test(w)));
    assert.equal(record.quick.coverage.tasksCounted, 0);
    // Only the convention control answered: 8 tasks x 2 arms. The unit's 16 tasks x 2 arms were never asked.
    assert.equal(calls.filter((l) => l.split(' ')[1] === 'answer').length, 16);
  } finally { r.cleanup(); }
});

test('the record keeps each control\'s checks with their numbers, and the markdown names which control passed and which failed', { timeout: 600000 }, () => {
  const { renderUnitRecord } = require('../../cap/unitrecord.js');
  const r = rig();
  try {
    const { record } = paidStage(r, { FAKE_KP_NO_ORACLE: '1' });
    const byName = Object.fromEntries(record.quick.controls.results.map((x) => [x.control, x]));
    assert.equal(byName['convention-control'].status, 'PASS');
    assert.equal(byName.ladder.status, 'FAIL');
    for (const x of record.quick.controls.results) {
      assert.ok(x.checks.length > 0 && x.checks.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean' && typeof c.detail === 'string'), x.control);
    }
    assert.ok(byName['convention-control'].checks.some((c) => /A interval contains 0/.test(c.name) && /A gap .*\[/.test(c.detail)), 'the A check and its interval are stored');
    const md = renderUnitRecord(record);
    assert.match(md, /convention-control PASS, ladder FAIL/);
    assert.match(md, /ladder FAIL: .*no:/, 'the failed check is printed with its numbers');
  } finally { r.cleanup(); }
});

test('controls only: the controls run and the unit does not; the plan then counts the cached calls as free, section by section', { timeout: 600000 }, () => {
  const { planUnitCalls } = require('../../cap/unitstage.js');
  const r = rig();
  try {
    const baselinesDir = freeze(r);
    const outDir = path.join(r.root, 'runs');
    const base = { kind: 'context', name: 'k-rules', repo: r.repo, runId: 'kp-test', outDir, provider: 'kiro', depths: ['quick'], subjectModel: 'claude-sonnet-5.5', judges: [...PILOT_JUDGES], baselinesDir };
    const before = planUnitCalls({ ...base });
    assert.ok(before.convention.calls > 0 && before.ladder.calls > 0 && before.unit.calls > 0);
    assert.equal(before.convention.cached + before.ladder.cached + before.unit.cached, 0, 'nothing is cached before the first run');
    const { record } = withEnv({ FAKE_KP_LOG: r.log }, () => runUnitStage({ ...base, paid: { ...r.paid, cap: 100000 }, controlsOnly: true }));
    assert.equal(record.quick.controls.passed, true);
    assert.ok(record.quick.noData.some((w) => /controls only: the unit was not run/.test(w)));
    assert.equal(r.calls().filter((l) => l.split(' ')[1] === 'answer').length, 16, 'only the 16 convention answers');
    const after = planUnitCalls({ ...base });
    assert.equal(after.convention.new, 0, 'the controls are cached');
    assert.equal(after.ladder.new, 0);
    assert.equal(after.unit.new, after.unit.calls, 'the unit is all new');
    assert.equal(after.unit.calls, 16 * 2 + 16 + 16 * 2 * 2 * 3, '32 answers, 16 checklists, 192 judgments');
  } finally { r.cleanup(); }
});

test('an unreadable judge reply is asked once more, both calls counted; Met reads as MET', { timeout: 600000 }, () => {
  const r = rig();
  try {
    const counter = path.join(r.root, 'judge-count');
    const { record, calls } = paidStage(r, { FAKE_KP_BROKEN_FIRST: 'judge:1', FAKE_KP_COUNTER: counter, FAKE_KP_TITLE_CASE: '1' });
    assert.equal(record.quick.controls.passed, true);
    assert.equal(record.quick.coverage.tasksCounted, 16, 'the re-ask saved the judgment');
    assert.ok(!record.quick.noData.some((w) => /^FLAG/.test(w)));
    assert.equal(ledgerSpent(r.paid.ledger), calls.length * 15, 'the bad reply and its re-ask are both counted');
    const bad = fs.readdirSync(path.join(r.root, 'runs', 'kp-test', 'calls', 'judge')).filter((f) => /\.bad-1\.json$/.test(f));
    assert.equal(bad.length, 1, 'the unreadable reply is kept aside');
  } finally { r.cleanup(); }
});

test('judge replies still unreadable after their re-ask are flagged, not a silent NO DATA', { timeout: 600000 }, () => {
  const r = rig();
  try {
    const { record, calls } = paidStage(r, { FAKE_KP_BROKEN: 'judge' });
    assert.match(record.quick.noData[0], /^FLAG: only 0 of 16 tasks counted, under the floor of 12, and \d+ judge replies could not be read after one re-ask/);
    const judgeCalls = calls.filter((l) => l.split(' ')[1] === 'judge').length;
    assert.ok(judgeCalls > 0 && judgeCalls % 2 === 0, 'each judgment was asked exactly twice');
  } finally { r.cleanup(); }
});

test('the ledger reserves 15 before a call starts, so a killed call is still counted', () => {
  const r = rig();
  try {
    const seen = path.join(r.root, 'ledger-during-call');
    withEnv({ FAKE_KP_SEE_LEDGER: `${r.paid.ledger}:${seen}` }, () => paidCall({ ...r.paid, model: 'glm-5', prompt: 'hello', out: path.join(r.root, 'out', 'a') }));
    const during = fs.readFileSync(seen, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(during.map((l) => [l.counted, l.reserved]), [[15, true]], 'during the call the ledger already counts it at 15');
    assert.equal(ledgerSpent(r.paid.ledger), 15, 'the settle line adds nothing for a call under 15');
  } finally { r.cleanup(); }
});

/** Runs one owner script with the fake kiro-cli and a scratch work dir. */
const script = (name, args, env) => spawnSync('bash', [path.join(BENCH, 'cap', 'pilot', name), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('the owner scripts: dry runs are free, a paid run needs --cap, and the paid path runs end to end on the fake', { timeout: 120000 }, () => {
  const r = rig();
  try {
    const baselines = path.join(r.root, 'baselines');
    const env = { KP_PILOT_WORK: path.join(r.root, 'kp'), KP_KIRO_BIN: FAKE, KP_AUTH_DB: r.paid.authDb, KP_PILOT_LOCK: path.join(r.root, 'kp.lock'), FAKE_KP_LOG: r.log,
      KP_BASELINE_OUT: path.join(baselines, 'context-k-orchestrator-shared', 'baseline.json'), KP_BASELINES: baselines };
    const dry = script('author-baseline.sh', ['--dry-run', '--cap', '120'], env);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /at most 8 calls, worst case 120 credits at 15 per call; ledger spent 0; cap 120; the worst case fits/);
    assert.equal(script('author-baseline.sh', [], env).status, 64);
    // A scratch HOME left by a killed run (with its sign-in copy) is removed before the first call.
    const stale = path.join(env.KP_PILOT_WORK, 'author', 'home-killed', '.local', 'share', 'kiro-cli');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'data.sqlite3'), 'copy');
    const paid = script('author-baseline.sh', ['--cap', '120'], env);
    assert.equal(paid.status, 0, paid.stderr);
    assert.equal(loadUnitBaseline(env.KP_BASELINE_OUT).name, 'k-orchestrator-shared');
    assert.equal(r.calls().length, 4);
    assert.equal(fs.existsSync(path.join(env.KP_PILOT_WORK, 'author', 'home-killed')), false, 'the stale sign-in copy is gone');

    const runDry = script('run-pilot.sh', ['--dry-run', '--cap', '1200'], env);
    assert.equal(runDry.status, 0, runDry.stderr);
    assert.match(runDry.stdout, /dry run, no call made: context:k-orchestrator-shared at quick depth, agent claude-sonnet-5\.5, judges qwen3-coder-next, gpt-5\.6-luna, grok-4\.7/);
    assert.match(runDry.stdout, /would stop before the first call: the baseline of context:k-orchestrator-shared is not signed off/);
    assert.equal(script('run-pilot.sh', [], env).status, 64);
    // The written baseline is not signed off yet, so the paid path stops before its first call.
    const run = script('run-pilot.sh', ['--cap', '8760'], env);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /no paid call made.*not signed off/);
    assert.equal(r.calls().length, 4);
    // The owner signs it off; the paid path then runs the whole quick pilot on the fake, within the cap.
    const b = JSON.parse(fs.readFileSync(env.KP_BASELINE_OUT, 'utf8'));
    fs.writeFileSync(env.KP_BASELINE_OUT, JSON.stringify({ ...b, source: { ...b.source, signedOffBy: 'test owner' } }));
    const signed = script('run-pilot.sh', ['--cap', '8760'], env);
    assert.equal(signed.status, 0, signed.stderr);
    assert.match(signed.stdout, /wrote .*context-k-orchestrator-shared\.json/);
    assert.ok(ledgerSpent(path.join(env.KP_PILOT_WORK, 'run-ledger.jsonl')) <= 8760);
  } finally { r.cleanup(); }
});

test('the pilot briefs file matches Appendix C: 16 briefs in two batches of 8 for the pilot unit', () => {
  const { loadBriefs } = require('../../cap/unitauthor.js');
  const b = loadBriefs(path.join(BENCH, 'cap', 'unit-baselines', 'context-k-orchestrator-shared', 'briefs.json'), 'context:k-orchestrator-shared');
  assert.deepEqual(b.batches, ['b1', 'b2']);
  assert.ok(fs.existsSync(path.join(REPO, 'context', 'k-orchestrator-shared.md')));
});

test('each unit kind has its own frame: the keep arm reads it ahead of the unit, the writer and reviewer are told what the unit is', () => {
  const { PAID_FRAME } = require('../../cap/units.js');
  const { withUnit } = require('../../cap/kiroprovider.js');
  const { writePrompt, reviewPrompt, fixPrompt } = require('../../cap/unitauthor.js');
  const briefs = [{ id: 't01', batch: 'b1', section: 'S', situation: 'x', good: 'y' }];
  for (const kind of ['agent', 'sop', 'context']) {
    const f = PAID_FRAME[kind];
    assert.ok(withUnit(f.answer, 'UNIT TEXT', 'the request').startsWith(`${f.answer}\n<<<FILE\nUNIT TEXT\nFILE>>>`), kind);
    for (const p of [writePrompt(f, 'U', briefs), reviewPrompt(f, 'U', briefs, []), fixPrompt(f, 'U', briefs, [])]) assert.ok(p.includes(f.noun) && p.includes(f.tasks), kind);
  }
  assert.match(PAID_FRAME.sop.answer, /started the procedure \(SOP\)/);
  assert.match(PAID_FRAME.sop.tasks, /the user's yes for its scope or for committing/);
  assert.match(PAID_FRAME.agent.answer, /You are the agent defined below/);
});
