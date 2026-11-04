// SPDX-License-Identifier: Apache-2.0
/**
 * Whole-pipeline offline test. A scripted grader judges eight synthetic pairs once; that stored
 * run is then judged again from stored files alone with the replay plugin, and scored again with
 * no plugin at all: judge, read, un-blind, aggregate, verdict, with no model call, no credential
 * and no network. Also pins what makes stored records stale: a template edit, a sanitizer version
 * change and a decision-rule change.
 * Run: node --test bench/test/pipeline.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runJudging, scoreSkill } = require('../run/judge');
const { openStore } = require('../lib/store');
const { createReplayPlugin, replayFromStore } = require('../plugins/replay');
const { loadTemplate, JUDGING_DIR } = require('../lib/judge-prompt');
const { decisionRuleSha256, digestRuleFields, decisionRuleFields } = require('../lib/decision-rule');
const { sha256 } = require('../lib/provenance');
const { SKILL } = require('./support/records');
const { roster } = require('./support/roster');
const { CONTEXT, taskSetOf, writePairs, overallReply, scriptedPlugin } = require('./support/run-fixture');

const TASKS = 8;
const CALLS = TASKS * 3 * 2;
const live = () => ({ judges: roster(3).map((s) => ({ ...s, plugin: 'scripted' })) });
const offline = () => ({ judges: roster(3).map((s) => ({ ...s, plugin: 'replay' })) });
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${what}: ${got} vs ${want}`);

const scratch = [];
test.after(() => scratch.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-pipeline-'));
  scratch.push(dir);
  return openStore(dir);
};

/** A fresh store with the pairs of the synthetic tasks and nothing else. */
function pairsOnly() {
  const store = newStore();
  writePairs(store, taskSetOf(TASKS).tasks);
  return store;
}

const copyJudgments = (from, to, keep = () => true) =>
  from.listJudgments(SKILL).filter(keep).forEach((rec) => to.writeJudgment(rec));

let published = null;
/** The stored run: pairs, judgments and result made by the scripted grader. Built once. */
async function publishedRun() {
  if (published) return published;
  const store = pairsOnly();
  const plugin = scriptedPlugin();
  const out = await runJudging({
    store,
    skill: SKILL,
    taskSet: taskSetOf(TASKS),
    config: live(),
    plugins: { scripted: plugin },
    context: CONTEXT,
  });
  published = { store, plugin, out };
  return published;
}

const args = (store, extra = {}) => ({
  store,
  skill: SKILL,
  taskSet: taskSetOf(TASKS),
  context: CONTEXT,
  ...extra,
});

// ---- the pinned result ---------------------------------------------------------------------

/** The result of the scripted scores in support/run-fixture.js, worked out by hand. */
function assertPinnedResult(result) {
  const verdict = result.verdict;
  assert.equal(verdict.verdict, 'keep');
  assert.equal(verdict.judge_verdict, 'keep');
  assert.equal(verdict.pairs, 8);
  near(verdict.mean, 25 / 12, 'mean gap');
  near(verdict.ci[0], 1.7948328742679234, 'interval low');
  near(verdict.ci[1], 2.3718337923987436, 'interval high');
  near(verdict.prune_ci[1], 2.449051885670796, 'prune bound');
  for (const count of ['excluded', 'load_failed', 'treatment_failed', 'unscored', 'invalid']) {
    assert.equal(verdict[count], 0, count);
  }
  assert.equal(verdict.word_check.gate, 'off');
  assert.match(verdict.reason, /^mean score gap 2\.08, 95% lower bound above \+0\.1; word checks off/);
  assert.deepEqual(result.pair_status, { scored: 8, unscored: 0, invalid: 0 });
  assert.deepEqual(result.judge_participation, { scored: 24, unscored: 0, invalid: 0 });
  assert.equal(result.decision_rule, 'paired-t/v1');
  assert.equal(result.rule_sha256, decisionRuleSha256());
  const gaps = result.pairs.map((p) => p.mean_delta);
  [7 / 3, 2, 2, 5 / 3, 7 / 3, 2, 5 / 3, 8 / 3].forEach((want, i) => near(gaps[i], want, `task-${i + 1} gap`));
}

test('a scripted run over synthetic pairs gives the pinned result', async () => {
  const { out, plugin, store } = await publishedRun();
  assert.equal(out.complete, true);
  assert.equal(out.calls, CALLS);
  assert.equal(plugin.calls.length, CALLS);
  assertPinnedResult(out.result.result);
  assertPinnedResult(store.readResult(SKILL).result);
});

test('replay: the stored run judged again from stored files gives the same result with no model call', async () => {
  const source = await publishedRun();
  const target = pairsOnly();
  const replay = replayFromStore(source.store, SKILL);
  let served = 0;
  const counting = { ...replay, runGrader: (call) => { served += 1; return replay.runGrader(call); } };
  const out = await runJudging({ ...args(target), config: offline(), plugins: { replay: counting } });
  assert.equal(out.complete, true);
  assert.equal(out.calls, CALLS);
  assert.equal(served, CALLS);
  assertPinnedResult(out.result.result);
  assert.deepEqual(out.result.result, source.out.result.result, 'the same aggregation, field for field');
  assert.deepEqual(out.result.inputs, source.out.result.inputs, 'and the same input digest');
  for (const rec of target.listJudgments(SKILL)) {
    const original = source.store.readJudgment(SKILL, rec.task_id, rec.seat, rec.order);
    assert.equal(rec.inputs.judge_input_sha256, original.inputs.judge_input_sha256);
    assert.equal(rec.raw_text, original.raw_text);
    assert.equal(rec.plugin, 'replay');
    assert.deepEqual(rec.cost, { usd: 0 });
    assert.notEqual(rec.nonce, original.nonce, 'the new prompt carried a new marker id');
  }
});

test('verdict step: stored judgments score with no plugin at all', async () => {
  const source = await publishedRun();
  const target = pairsOnly();
  copyJudgments(source.store, target);
  assert.equal(target.readResult(SKILL), null);
  const out = scoreSkill(args(target, { config: offline() }));
  assert.equal(out.complete, true);
  assert.equal(out.calls, 0);
  assert.equal(out.result_written, true);
  assertPinnedResult(out.result.result);
  const again = scoreSkill(args(target, { config: offline() }));
  assert.equal(again.result_written, false, 'the stored result is current');
});

test('the replayed run scores the same in a second copy: a published run can be re-checked', async () => {
  const source = await publishedRun();
  const copy = pairsOnly();
  copyJudgments(source.store, copy);
  copy.writeResult(source.store.readResult(SKILL));
  const out = scoreSkill(args(copy, { config: offline() }));
  assert.equal(out.complete, true);
  assert.equal(out.result_written, false);
  assertPinnedResult(out.result.result);
});

test('an unreadable stored reply replays as unreadable: the seat is invalid in both runs', async () => {
  const bad = ({ index, seatIndex, a, b }) => (index === 1 && seatIndex === 2 ? 'cannot decide' : overallReply(a, b));
  const sourceStore = pairsOnly();
  const first = await runJudging({
    ...args(sourceStore),
    config: live(),
    plugins: { scripted: scriptedPlugin({ reply: bad }) },
  });
  const target = pairsOnly();
  const second = await runJudging({
    ...args(target),
    config: offline(),
    plugins: { replay: replayFromStore(sourceStore, SKILL) },
  });
  assert.deepEqual(second.result.result, first.result.result);
  const pair = second.result.result.pairs[0];
  assert.equal(pair.judge_status['seat-3'], 'invalid');
  assert.equal(pair.scored, true);
  assert.equal(second.result.result.judge_participation.invalid, 1);
  assert.equal(target.readJudgment(SKILL, 'task-1', 'seat-3', 'with-first').status, 'unparsable');
});

// ---- what makes stored records stale -------------------------------------------------------

test('a template edit makes every judgment pending, and replay cannot serve the new prompts', async () => {
  const source = await publishedRun();
  const draft = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-draft-')), 'draft.md');
  scratch.push(path.dirname(draft));
  fs.writeFileSync(draft, `${fs.readFileSync(path.join(JUDGING_DIR, 'judge-prompt.v2.md'), 'utf8').trimEnd()}\nBe brief.\n`);
  const template = loadTemplate(draft);
  const edited = scoreSkill(args(source.store, { config: live(), template }));
  assert.equal(edited.complete, false);
  assert.equal(edited.pending, CALLS);
  assert.equal(edited.result, null);

  const target = pairsOnly();
  copyJudgments(source.store, target);
  await assert.rejects(
    runJudging({ ...args(target, { template }), config: offline(), plugins: { replay: replayFromStore(source.store, SKILL) } }),
    new RegExp(`cannot serve ${CALLS} of ${CALLS} pending judge calls`),
  );
  assert.equal(target.readResult(SKILL), null, 'nothing was built from stale judgments');
  const untouched = target.listJudgments(SKILL).every((r) => r.prompt_sha256 !== template.sha256);
  assert.ok(untouched, 'nothing was written for the new template');

  const fresh = scriptedPlugin();
  const rerun = await runJudging({ ...args(target, { template }), config: live(), plugins: { scripted: fresh } });
  assert.equal(rerun.calls, CALLS, 'a live run re-judges everything under the new template');
  assert.equal(rerun.complete, true);
  assert.ok(target.listJudgments(SKILL).every((r) => r.prompt_sha256 === template.sha256));
});

/** The record as an older sanitizer would have stored it: its digest moves with the version. */
function withSanitizerVersion(rec, version) {
  const { judge_input_sha256: _drop, ...rest } = rec.inputs;
  const inputs = { ...rest, sanitizer_version: version };
  return { ...rec, sanitizer_version: version, inputs: { ...inputs, judge_input_sha256: sha256(inputs) } };
}

test('a sanitizer version change makes judgments pending', async () => {
  const source = await publishedRun();
  const old = pairsOnly();
  for (const rec of source.store.listJudgments(SKILL)) old.writeJudgment(withSanitizerVersion(rec, rec.sanitizer_version - 1));
  const out = scoreSkill(args(old, { config: live() }));
  assert.equal(out.complete, false);
  assert.equal(out.pending, CALLS);
  const plugin = scriptedPlugin();
  const rerun = await runJudging({ ...args(old), config: live(), plugins: { scripted: plugin } });
  assert.equal(rerun.calls, CALLS);
  assert.equal(rerun.complete, true);
  assertPinnedResult(rerun.result.result);
  assert.ok(old.listJudgments(SKILL).every((r) => r.attempts === 1 && r.sanitizer_version === source.store.listJudgments(SKILL)[0].sanitizer_version));
});

test('a sanitizer rules change makes judgments pending', async () => {
  const source = await publishedRun();
  const old = pairsOnly();
  for (const rec of source.store.listJudgments(SKILL)) {
    const { judge_input_sha256: _drop, ...rest } = rec.inputs;
    const inputs = { ...rest, sanitizer_rules_sha256: 'a'.repeat(64) };
    old.writeJudgment({ ...rec, sanitizer_rules_sha256: 'a'.repeat(64), inputs: { ...inputs, judge_input_sha256: sha256(inputs) } });
  }
  assert.equal(scoreSkill(args(old, { config: live() })).pending, CALLS);
});

test('a decision-rule change makes the result stale and it re-aggregates with no plugin call', async () => {
  const source = await publishedRun();
  const target = pairsOnly();
  copyJudgments(source.store, target);
  const oldRule = digestRuleFields({ ...decisionRuleFields(), KEEP_FLOOR: 0.05 });
  assert.notEqual(oldRule, decisionRuleSha256());
  const stored = source.store.readResult(SKILL);
  target.writeResult({
    ...stored,
    rule_sha256: oldRule,
    inputs: { ...stored.inputs, rule_sha256: oldRule },
    result: { ...stored.result, verdict: { ...stored.result.verdict, verdict: 'prune', reason: 'made under an old rule' } },
  });

  const plugin = scriptedPlugin();
  const out = await runJudging({ ...args(target), config: live(), plugins: { scripted: plugin } });
  assert.equal(out.calls, 0, 'no judge call');
  assert.equal(plugin.calls.length, 0);
  assert.equal(out.result_written, true, 'the stale result was rebuilt');
  assert.equal(out.result.rule_sha256, decisionRuleSha256());
  assertPinnedResult(out.result.result);
  assertPinnedResult(target.readResult(SKILL).result);
});

test('an edited pair makes the result and its judgments stale', async () => {
  const source = await publishedRun();
  const target = pairsOnly();
  copyJudgments(source.store, target);
  target.writeResult(source.store.readResult(SKILL));
  const edited = target.readPair(SKILL, 'task-1', 'with');
  const { makePair } = require('./support/records');
  target.writePair(makePair({ taskId: 'task-1', arm: 'with', request: taskSetOf(TASKS).tasks[0].task, answer: 'A different reply ZQHI1.', start: edited.start, final: edited.final }));
  const out = scoreSkill(args(target, { config: live() }));
  assert.equal(out.complete, false);
  assert.equal(out.pending, 6, 'the six calls on that task need judging again');
});

// ---- a missing replay key ------------------------------------------------------------------

test('a missing replay key errors and writes nothing', async () => {
  const source = await publishedRun();
  const records = source.store.listJudgments(SKILL);
  const first = records.find((r) => r.task_id === 'task-1' && r.seat === 'seat-1' && r.order === 'with-first');
  const gap = records.filter((r) => r !== first);

  const guarded = pairsOnly();
  await assert.rejects(
    runJudging({ ...args(guarded), config: offline(), plugins: { replay: createReplayPlugin({ records: gap }) } }),
    /cannot serve 1 of 48 pending judge calls/,
  );
  assert.deepEqual(guarded.listJudgments(SKILL), []);
  assert.equal(guarded.readResult(SKILL), null);

  // A plugin that cannot pre-check still errors on the first call it cannot serve.
  const blind = pairsOnly();
  const replay = createReplayPlugin({ records: gap });
  await assert.rejects(
    runJudging({ ...args(blind), config: offline(), plugins: { replay: { id: 'replay', runGrader: replay.runGrader } } }),
    (err) => err.code === 'REPLAY_MISSING_REPLY' && err.message.includes(first.inputs.judge_input_sha256),
  );
  assert.deepEqual(blind.listJudgments(SKILL), [], 'the missing call was the first, so nothing was stored');
  assert.equal(blind.readResult(SKILL), null);
});

test('a missing replay key never turns into a made-up score', async () => {
  const empty = createReplayPlugin({ records: [] });
  const target = pairsOnly();
  await assert.rejects(runJudging({ ...args(target), config: offline(), plugins: { replay: empty } }), /cannot serve/);
  assert.equal(scoreSkill(args(target, { config: offline() })).result, null);
});

// ---- the run directory ---------------------------------------------------------------------

test('a task id that could leave the run directory is refused and nothing is written outside it', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-escape-'));
  scratch.push(outer);
  const run = path.join(outer, 'run');
  fs.mkdirSync(run);
  const before = fs.readdirSync(outer, { recursive: true }).map(String).sort();
  const store = openStore(run);
  for (const id of ['../escape', 'a/b', '/tmp/abs', '..']) {
    const taskSet = { tasks: [{ ...taskSetOf(1).tasks[0], id }] };
    await assert.rejects(
      runJudging({ ...args(store), taskSet, config: live(), plugins: { scripted: scriptedPlugin() } }),
      /invalid task id/,
      id,
    );
    assert.throws(() => scoreSkill({ ...args(store), taskSet, config: live() }), /invalid task id/, id);
  }
  await assert.rejects(runJudging({ ...args(store), skill: '../x', config: live(), plugins: {} }), /invalid skill/);
  assert.deepEqual(fs.readdirSync(outer, { recursive: true }).map(String).sort(), before);
});

test('a seat label that could leave the run directory is refused by the roster', async () => {
  const store = pairsOnly();
  for (const seat of ['../x', 'a/b', '/abs', '..']) {
    const config = { judges: roster(3).map((s, i) => (i === 0 ? { ...s, seat, plugin: 'scripted' } : { ...s, plugin: 'scripted' })) };
    await assert.rejects(runJudging({ ...args(store), config, plugins: { scripted: scriptedPlugin() } }), /judge roster is invalid/, seat);
  }
  assert.deepEqual(store.listJudgments(SKILL), []);
});

test('a whole run leaves directories at 0700 and files at 0600', { skip: process.platform === 'win32' && 'file modes are not enforced on this platform' }, async () => {
  const { store } = await publishedRun();
  const entries = fs.readdirSync(store.root, { recursive: true, withFileTypes: true });
  assert.ok(entries.length > CALLS);
  for (const entry of entries) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    assert.equal(fs.statSync(full).mode & 0o777, entry.isDirectory() ? 0o700 : 0o600, full);
  }
  assert.equal(entries.filter((e) => e.name.endsWith('.tmp')).length, 0, 'no temporary file is left');
});

// ---- core stays offline --------------------------------------------------------------------

test('core, the driver and the replay plugin import no network, process or provider module', () => {
  const root = path.join(__dirname, '..');
  const ALLOWED = new Set(['node:crypto', 'node:fs', 'node:path']);
  const sources = ['lib', 'run', 'plugins'].flatMap((dir) =>
    fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(root, dir, f)),
  );
  assert.ok(sources.length >= 15);
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    for (const [, module] of text.matchAll(/require\('([^']+)'\)/g)) {
      assert.ok(module.startsWith('.') || ALLOWED.has(module), `${rel} requires ${module}`);
    }
    assert.doesNotMatch(text, /process\.env|\bfetch\(|XMLHttpRequest|WebSocket|child_process/, rel);
  }
});
