// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paid half of reply-check.js with stubs: a fake kiro-cli for the Claude reviewer and a stub panel caller, so no
// model is called. Also the frozen prompts, the run-cap check and the side-by-side compare.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rc = require('../../ops/prompt-fixes/reply-check.js');
const rv = require('../../ops/prompt-fixes/reply-review.js');

const TASK = 't1-bug-date-range';
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join('/var/tmp', 'rcr-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const upd = (update) => ({ type: 'sessionUpdate', data: { sessionId: 's1', update } });
const say = (text) => upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const tool = (title, kind, rawInput) => upd({ sessionUpdate: 'tool_call', toolCallId: 'run_1', title, kind, rawInput });

/** One run under `dir`: result.json, stream.jsonl and a credit-ledger line of `credits`. */
function writeRun(dir, { arm = 'konductor-adaptive-p12', rep = 1, credits = 5, events } = {}) {
  const d = path.join(dir, `r${rep}`, arm, TASK, '1');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ armId: arm, taskId: TASK, replicate: rep, credits, orch: { makerSpawns: 0, reviewerSpawns: 0 } }));
  const ev = events ?? [say('Orchestration: auto (default)\nPlan: solo, because 1 file\nSkills: none fit\n'), tool('Edit', 'edit', { path: 'a.js' })];
  fs.writeFileSync(path.join(d, 'stream.jsonl'), `${ev.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.appendFileSync(path.join(dir, `r${rep}`, 'credit-ledger.jsonl'), `${JSON.stringify({ kind: 'run', unit: 'credits', credits, charged: credits })}\n`);
  return d;
}

const quiet = () => {};

test('scoreRun: a `Plan: after a read-only look` placeholder, then the real Plan line before the first write, passes E1 to E3', () => {
  const events = [say('Orchestration: auto (default)\nPlan: after a read-only look\nSkills: none fit\n'), tool('Run Command', 'execute', { command: 'ls' }),
    say('Plan: solo, because 1 file\n'), tool('Edit', 'edit', { path: 'a.js' })];
  const s = rc.scoreRun({ events, orch: { makerSpawns: 0, reviewerSpawns: 0 }, taskId: TASK, stopped: true });
  const met = Object.fromEntries(s.checks.map((c) => [c.id, c.met]));
  assert.deepEqual([met.E1, met.E2, met.E3, met.E4], [true, true, true, true]);
  const late = [say('Plan: after a read-only look\n'), tool('Edit', 'edit', { path: 'a.js' }), say('Plan: solo, because 1 file\n')];
  assert.equal(rc.scoreRun({ events: late, orch: null, taskId: TASK, stopped: true }).checks.find((c) => c.id === 'E2').met, false);
});

test('prompts: a prefix and a task filter, a manifest entry with the score, and a prompt is never rewritten', () => {
  const runs = tmp(); const out = tmp();
  writeRun(runs);
  const log = [];
  rc.main(['prompts', '--runs', runs, '--out', out, '--arm', 'konductor-adaptive-p12', '--prefix', 'candidate', '--early', 'yes'], (l) => log.push(l));
  rc.main(['prompts', '--runs', runs, '--out', out, '--arm', 'konductor-adaptive-p12', '--prefix', 'other', '--tasks', 't12-mux-parallel-merge'], quiet);
  const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(m.entries), ['candidate.t1-bug-date-range.r1']);
  const e = m.entries['candidate.t1-bug-date-range.r1'];
  assert.equal(e.taskId, TASK);
  assert.equal(e.score.E1, 'met');
  assert.equal(e.score.E6, 'not-reached', '--early yes: the end of the run is not reached');
  const file = path.join(out, 'candidate.t1-bug-date-range.r1.review-prompt.txt');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(e.sha256, require('node:crypto').createHash('sha256').update(before).digest('hex'));
  fs.appendFileSync(path.join(e.dir, 'stream.jsonl'), `${JSON.stringify(say('more text'))}\n`);
  rc.main(['prompts', '--runs', runs, '--out', out, '--arm', 'konductor-adaptive-p12', '--prefix', 'candidate', '--early', 'yes'], (l) => log.push(l));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(log.some((l) => /kept \(frozen\)/.test(l)));
});

test('mayRun: one more run must fit the run cap and the total cap (runs plus the Claude ledger)', () => {
  const runs = tmp(); const ledger = path.join(tmp(), 'claude-ledger.jsonl');
  writeRun(runs, { credits: 60 });
  assert.deepEqual(rc.mayRun({ runs, ledger, cap: 300, runCap: 72, runLimit: 6 }), { ok: true, left: 12 });
  assert.match(rc.mayRun({ runs, ledger, cap: 300, runCap: 65, runLimit: 6 }).why, /run cap: 60 spent of 65/);
  fs.writeFileSync(ledger, `${JSON.stringify({ counted: 236 })}\n`);
  assert.match(rc.mayRun({ runs, ledger, cap: 300, runCap: 72, runLimit: 6 }).why, /total cap: 296 spent of 300/);
});

// A fake kiro-cli: answers every check of the prompt with "met" (or prose with no JSON when the prompt holds NOJSON).
function fakeKiro(dir) {
  const f = path.join(dir, 'fake-kiro.js');
  fs.writeFileSync(f, `#!/usr/bin/env node
const p = process.argv.at(-1);
const ids = [...p.matchAll(/^(E\\d): /gm)].map((m) => m[1]);
const text = p.includes('NOJSON') ? 'no json here' : JSON.stringify({ checks: ids.map((id) => ({ id, verdict: 'met', quote: 'q' })), decisionInOtherWords: 'solo' });
const line = (type, data) => process.stdout.write(JSON.stringify({ type, data }) + '\\n');
line('metadata', { sessionId: 'f', meteringUsage: [{ value: 2, unit: 'credit' }] });
line('runFinished', { status: 'success', stopReason: 'end_turn', finalText: text, finalTextTruncated: false });
`);
  fs.chmodSync(f, 0o755);
  const auth = path.join(dir, 'auth.sqlite3');
  fs.writeFileSync(auth, 'fake');
  return { bin: f, auth };
}

/** A stub panel caller: the first judge says not-met on E1, the others met; `bad` judges reply with no JSON. */
function stubPanel(calls, { bad = [] } = {}) {
  return async ({ model, prompt }) => {
    calls.push(model);
    const ids = [...prompt.matchAll(/^(E\d): /gm)].map((m) => m[1]);
    if (bad.includes(model)) return { text: 'nope', usd: 0.001 };
    const verdict = (id) => (model === 'gpt-5.6-luna' && id === 'E1' ? 'not-met' : 'met');
    return { text: JSON.stringify({ checks: ids.map((id) => ({ id, verdict: verdict(id), quote: '' })), decisionInOtherWords: 'solo' }), usd: 0.002 };
  };
}

async function setup() {
  const root = tmp();
  const runs = path.join(root, 'runs'); const prompts = path.join(root, 'prompts');
  writeRun(runs, { credits: 6 });
  writeRun(runs, { rep: 2, credits: 6 });
  rc.main(['prompts', '--runs', runs, '--out', prompts, '--arm', 'konductor-adaptive-p12', '--prefix', 'candidate', '--early', 'yes'], quiet);
  return { root, runs, prompts, out: path.join(root, 'reviews'), work: path.join(root, 'work'), ...fakeKiro(root) };
}

test('review: one Claude call and three panel calls per prompt, ledgers written, a rerun calls nothing', async () => {
  const s = await setup();
  const calls = [];
  const o = { promptsDir: s.prompts, out: s.out, claudeModel: 'claude-opus-5.5', capCredits: 300, runsDir: s.runs, capUsd: 0.5, workDir: s.work, kiroBin: s.bin, authDb: s.auth, panelCaller: stubPanel(calls), log: quiet };
  const r = await rv.review(o);
  assert.equal(r.claude, 2);
  assert.equal(calls.length, 6);
  assert.equal(ledgerTotal(path.join(s.out, 'claude-ledger.jsonl'), 'counted'), 30, 'counted at 15 each');
  assert.ok(fs.existsSync(path.join(s.out, 'gpt-5.6-luna', 'candidate.t1-bug-date-range.r1.json')));
  const again = await rv.review(o);
  assert.equal(calls.length, 6);
  assert.equal(again.claude, 0);
});

test('review: the credit cap refuses the Claude call that could pass it, before it starts', async () => {
  const s = await setup();
  const calls = [];
  // Runs spent 12; one Claude call is counted 15: 12 + 15 + 15 > 40 refuses the second.
  await assert.rejects(rv.review({ promptsDir: s.prompts, out: s.out, claudeModel: 'claude-opus-5.5', capCredits: 40, runsDir: s.runs, capUsd: 0.5, workDir: s.work, kiroBin: s.bin, authDb: s.auth, panelCaller: stubPanel(calls), log: quiet }), /REFUSED.*Claude.*27 spent of the 40 cap/);
  assert.equal(ledgerTotal(path.join(s.out, 'claude-ledger.jsonl'), 'counted'), 15);
});

test('review: the USD cap refuses a panel call whose high estimate could pass it; a bad reply is asked once more, then marked failed', async () => {
  const s = await setup();
  const calls = [];
  await assert.rejects(rv.review({ promptsDir: s.prompts, out: s.out, claudeModel: 'claude-opus-5.5', capCredits: 300, runsDir: s.runs, capUsd: 0.000001, workDir: s.work, kiroBin: s.bin, authDb: s.auth, panelCaller: stubPanel(calls), log: quiet }), /REFUSED.*gpt-5.6-luna.*USD 0 spent of 0.000001/);
  assert.equal(calls.length, 0);
  const s2 = await setup();
  const calls2 = [];
  await rv.review({ promptsDir: s2.prompts, out: s2.out, claudeModel: 'claude-opus-5.5', capCredits: 300, runsDir: s2.runs, capUsd: 0.5, workDir: s2.work, kiroBin: s2.bin, authDb: s2.auth, panelCaller: stubPanel(calls2, { bad: ['deepseek-3.2'] }), log: quiet });
  assert.equal(calls2.filter((m) => m === 'deepseek-3.2').length, 4, 'two tries for each of the two prompts');
  assert.ok(fs.existsSync(path.join(s2.out, 'deepseek-3.2', 'candidate.t1-bug-date-range.r1.failed')));
  const usd = ledgerTotal(path.join(s2.out, 'panel-ledger.jsonl'), 'usd');
  assert.ok(Math.abs(usd - (4 * 0.002 + 4 * 0.001)) < 1e-9, `the ledger settles at the real USD (${usd})`);
});

test('compare: both reviewers side by side, the panel majority as the verdict, every disagreement flagged', async () => {
  const s = await setup();
  await rv.review({ promptsDir: s.prompts, out: s.out, claudeModel: 'claude-opus-5.5', capCredits: 300, runsDir: s.runs, capUsd: 0.5, workDir: s.work, kiroBin: s.bin, authDb: s.auth, panelCaller: stubPanel([]), log: quiet });
  const md = rv.compare({ promptsDir: s.prompts, reviewsDir: s.out });
  const row = md.split('\n').find((l) => l.startsWith('| candidate.t1-bug-date-range.r1 | E1 |'));
  assert.equal(row, '| candidate.t1-bug-date-range.r1 | E1 | met | met | not-met | met | met | met |  |');
  assert.match(md, /\| E1 \| 2 of 2 \| 2 of 2 \| 2 of 2 \| 0 \|/);
  fs.writeFileSync(path.join(s.out, 'claude-opus-5.5', 'candidate.t1-bug-date-range.r1.json'),
    JSON.stringify({ value: { checks: rc.expectationsFor(TASK).map((e) => ({ id: e.id, verdict: 'not-met', quote: '' })), decisionInOtherWords: 'none' } }));
  const md2 = rv.compare({ promptsDir: s.prompts, reviewsDir: s.out });
  assert.match(md2.split('\n').find((l) => l.startsWith('| candidate.t1-bug-date-range.r1 | E1 |')), /Claude differs/);
});

function ledgerTotal(file, key) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).reduce((a, e) => a + Number(e[key] ?? 0), 0);
}
