// SPDX-License-Identifier: Apache-2.0
/**
 * Judge driver tests: planning, calling a plugin, storing each judgment, retries, failures and the
 * call-site pin that keeps everything but the request, checklist, replies and changed files out
 * of the judge prompt. Offline: the grader is a script.
 * Run: node --test bench/test/judge.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runJudging, scoreSkill, DEFAULT_GRADER_LIMITS } = require('../run/judge');
const { openStore, MAX_ATTEMPTS } = require('../lib/store');
const { SANITIZER_VERSION, RULES_HASH } = require('../lib/sanitize');
const { SCALES } = require('../lib/judge-scale');
const { templateForScale } = require('../lib/judge-prompt');
const { SKILL, tempDir } = require('./support/records');
const { roster } = require('./support/roster');
const { CONTEXT, taskSetOf, writePairs, overallReply, scriptedPlugin } = require('./support/run-fixture');

const configFor = (pluginId = 'scripted', extra = {}) => ({
  judges: roster(3).map((s) => ({ ...s, plugin: pluginId })),
  ...extra,
});

/** A fresh store holding the pairs of an `n`-task set, and the arguments runJudging takes. */
function setup(t, { tasks = 8, plugin = scriptedPlugin(), config = configFor(), pairs = {} } = {}) {
  const store = openStore(tempDir(t));
  const taskSet = taskSetOf(tasks);
  writePairs(store, taskSet.tasks, pairs);
  return {
    store,
    taskSet,
    plugin,
    args: { store, skill: SKILL, taskSet, config, plugins: { [plugin.id]: plugin }, context: CONTEXT },
  };
}

const judgmentFiles = (store) => store.listJudgments(SKILL);

test('every planned call is made once and stored, and the result is built', async (t) => {
  const { store, plugin, args } = setup(t);
  const out = await runJudging(args);
  assert.equal(out.planned, 8 * 3 * 2, 'tasks x seats x orders');
  assert.equal(out.calls, 48);
  assert.equal(plugin.calls.length, 48);
  assert.equal(out.complete, true);
  assert.equal(out.pending, 0);
  assert.deepEqual(out.missing_pairs, []);
  assert.equal(out.result_written, true);
  assert.equal(judgmentFiles(store).length, 48);
  assert.deepEqual(store.readResult(SKILL), out.result);
});

test('one order per pair halves the calls', async (t) => {
  const { plugin, args } = setup(t);
  const out = await runJudging({ ...args, config: configFor('scripted', { ordersPerPair: 1 }) });
  assert.equal(out.calls, 24);
  assert.equal(plugin.calls.length, 24);
  assert.equal(out.complete, true);
});

test('a judgment records the template, sanitizer, scale, seat, order, digest, marker, reply and parse', async (t) => {
  const { store, args } = setup(t, { tasks: 3 });
  await runJudging(args);
  const template = templateForScale('overall');
  const rec = store.readJudgment(SKILL, 'task-1', 'seat-2', 'without-first');
  assert.equal(rec.skill, SKILL);
  assert.equal(rec.task_id, 'task-1');
  assert.equal(rec.seat, 'seat-2');
  assert.equal(rec.family, 'family-2');
  assert.equal(rec.plugin, 'scripted');
  assert.equal(rec.judge_model, '<provider>/<model-2>');
  assert.equal(rec.order, 'without-first');
  assert.equal(rec.judge_scale, 'overall');
  assert.equal(rec.prompt_version, SCALES.overall.promptVersion);
  assert.equal(rec.prompt_sha256, template.sha256);
  assert.equal(rec.sanitizer_version, SANITIZER_VERSION);
  assert.equal(rec.sanitizer_rules_sha256, RULES_HASH);
  assert.match(rec.nonce, /^[0-9a-f]{16}$/);
  assert.match(rec.inputs.judge_input_sha256, /^[0-9a-f]{64}$/);
  assert.equal(rec.status, 'ok');
  assert.equal(rec.attempts, 1);
  assert.equal(JSON.parse(rec.raw_text).winner, rec.parsed.winner);
  assert.equal(rec.parsed.problem, null);
  assert.deepEqual(rec.usage, { input_tokens: 10, output_tokens: 5 });
  assert.deepEqual(rec.cost, { usd: 0.001 });
  assert.equal(rec.error, null);
});

test('the digest leaves out the marker id: two runs agree on digests and differ on markers', async (t) => {
  const first = setup(t, { tasks: 3 });
  const second = setup(t, { tasks: 3 });
  await runJudging(first.args);
  await runJudging(second.args);
  const key = (r) => `${r.task_id}/${r.seat}.${r.order}`;
  const a = new Map(judgmentFiles(first.store).map((r) => [key(r), r]));
  const b = new Map(judgmentFiles(second.store).map((r) => [key(r), r]));
  assert.equal(a.size, 18);
  let differentMarkers = 0;
  for (const [k, rec] of a) {
    assert.equal(rec.inputs.judge_input_sha256, b.get(k).inputs.judge_input_sha256, k);
    if (rec.nonce !== b.get(k).nonce) differentMarkers += 1;
  }
  assert.equal(differentMarkers, a.size);
  for (const call of first.plugin.calls) {
    assert.ok(call.prompt.includes(`id=${[...a.values()].find((r) => r.inputs.judge_input_sha256 === call.input_sha256).nonce}`));
  }
});

test('the plugin gets the prompt, model, limits, a fixed seed and the input digest, and nothing else', async (t) => {
  const first = setup(t, { tasks: 2 });
  const second = setup(t, { tasks: 2 });
  await runJudging(first.args);
  await runJudging(second.args);
  const call = first.plugin.calls[0];
  assert.deepEqual(Object.keys(call).sort(), ['input_sha256', 'limits', 'model', 'prompt', 'seed']);
  assert.deepEqual(call.limits, DEFAULT_GRADER_LIMITS);
  assert.ok(Number.isInteger(call.seed) && call.seed >= 0);
  assert.equal(call.model, '<provider>/<model-1>');
  assert.deepEqual(
    first.plugin.calls.map((c) => [c.input_sha256, c.seed]),
    second.plugin.calls.map((c) => [c.input_sha256, c.seed]),
    'digests and seeds depend only on the inputs',
  );
  const custom = setup(t, { tasks: 2 });
  await runJudging({ ...custom.args, graderLimits: { timeout_ms: 5 } });
  assert.deepEqual(custom.plugin.calls[0].limits, { timeout_ms: 5, max_output_tokens: DEFAULT_GRADER_LIMITS.max_output_tokens });
});

test('a current judgment is never called again or overwritten', async (t) => {
  const { store, plugin, args } = setup(t, { tasks: 4 });
  await runJudging(args);
  const before = new Map(judgmentFiles(store).map((r) => [`${r.task_id}/${r.seat}.${r.order}`, fs.readFileSync(store.paths.judgment(SKILL, r.task_id, r.seat, r.order), 'utf8')]));
  const resultBefore = fs.readFileSync(store.paths.result(SKILL), 'utf8');
  const callsBefore = plugin.calls.length;
  const again = await runJudging(args);
  assert.equal(again.calls, 0);
  assert.equal(plugin.calls.length, callsBefore);
  assert.equal(again.result_written, false, 'a current result is left alone');
  assert.equal(again.complete, true);
  for (const [k, text] of before) {
    const [task, rest] = k.split('/');
    const [seat, order] = [rest.slice(0, rest.indexOf('.')), rest.slice(rest.indexOf('.') + 1)];
    assert.equal(fs.readFileSync(store.paths.judgment(SKILL, task, seat, order), 'utf8'), text, k);
  }
  assert.equal(fs.readFileSync(store.paths.result(SKILL), 'utf8'), resultBefore);
});

test('a run that stops part way resumes with only the calls that are left', async (t) => {
  const stopAt = 10;
  const plugin = scriptedPlugin({
    onCall: (call, n) => {
      if (n === stopAt) throw new Error('process stopped');
    },
  });
  const { store, args } = setup(t, { tasks: 4, plugin });
  await assert.rejects(runJudging(args), /process stopped/);
  assert.equal(judgmentFiles(store).length, stopAt - 1, 'the call that threw stored nothing');
  assert.equal(store.readResult(SKILL), null);
  const resumed = scriptedPlugin();
  const out = await runJudging({ ...args, plugins: { scripted: resumed } });
  assert.equal(out.calls, 4 * 3 * 2 - (stopAt - 1));
  assert.equal(out.complete, true);
});

test('a plugin that is not loaded fails before any call', async (t) => {
  const { store, plugin, args } = setup(t, { tasks: 2 });
  await assert.rejects(runJudging({ ...args, plugins: {} }), /plugin "scripted", which is not loaded/);
  await assert.rejects(runJudging({ ...args, plugins: { scripted: { id: 'scripted' } } }), /not loaded/);
  await assert.rejects(runJudging({ ...args, plugins: undefined }), /not loaded/);
  assert.equal(plugin.calls.length, 0);
  assert.equal(judgmentFiles(store).length, 0);
});

test('a pre-check that cannot serve every pending call stops the run before the first call', async (t) => {
  const plugin = { ...scriptedPlugin(), canServe: () => false };
  const { store, args } = setup(t, { tasks: 2, plugin });
  await assert.rejects(runJudging(args), /cannot serve 12 of 12 pending judge calls/);
  assert.equal(plugin.calls.length, 0);
  assert.equal(judgmentFiles(store).length, 0);
  assert.equal(store.readResult(SKILL), null);
});

test('a plugin that throws is a bug: the error propagates and nothing is stored for that call', async (t) => {
  const plugin = scriptedPlugin({ onCall: () => { throw new TypeError('plugin bug'); } });
  const { store, args } = setup(t, { tasks: 2, plugin });
  await assert.rejects(runJudging(args), /plugin bug/);
  assert.equal(judgmentFiles(store).length, 0);
});

test('a credential error stops the run at once and keeps the finished work', async (t) => {
  const plugin = scriptedPlugin();
  const real = plugin.runGrader.bind(plugin);
  plugin.runGrader = (call) =>
    plugin.calls.length === 4 ? { status: 'credential_error', raw_text: null, error: 'no valid login' } : real(call);
  const { store, args } = setup(t, { tasks: 3, plugin });
  await assert.rejects(runJudging(args), (err) => err.code === 'credential_error' && /no valid login/.test(err.message));
  assert.equal(plugin.calls.length, 4, 'no call after the credential error');
  assert.equal(judgmentFiles(store).length, 4);
  assert.equal(store.readResult(SKILL), null);
});

test('a refused or invalid call is stored with its status and retried up to the limit, then settles', async (t) => {
  for (const status of ['refused', 'invalid']) {
    const plugin = scriptedPlugin({ status });
    const { store, args } = setup(t, { tasks: 2, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
    const out = await runJudging(args);
    assert.equal(out.calls, 2 * 3 * MAX_ATTEMPTS, status);
    assert.equal(out.complete, true, 'settled judgments complete the run');
    const rec = judgmentFiles(store)[0];
    assert.equal(rec.status, status);
    assert.equal(rec.attempts, MAX_ATTEMPTS);
    assert.equal(rec.parsed, null);
    const pair = out.result.result.pairs[0];
    assert.deepEqual(Object.values(pair.judge_status), ['invalid', 'invalid', 'invalid'], status);
    assert.equal(pair.scored, false);
    assert.equal(out.result.result.verdict.verdict, 'needs human review');
    const again = await runJudging(args);
    assert.equal(again.calls, 0, 'a settled failure is not retried on the next run');
  }
});

test('a transient failure is stored, retried, and leaves the seat unscored', async (t) => {
  const plugin = scriptedPlugin({ status: 'transient' });
  const { store, args } = setup(t, { tasks: 2, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  const out = await runJudging(args);
  assert.equal(out.calls, 2 * 3 * MAX_ATTEMPTS);
  const rec = judgmentFiles(store)[0];
  assert.equal(rec.status, 'transient');
  assert.deepEqual(Object.values(out.result.result.pairs[0].judge_status), ['unscored', 'unscored', 'unscored']);
});

test('a call that fails and then succeeds keeps the good judgment and counts both attempts', async (t) => {
  const plugin = scriptedPlugin();
  const real = plugin.runGrader.bind(plugin);
  const seen = new Set();
  plugin.runGrader = (call) => {
    if (!seen.has(call.input_sha256)) {
      seen.add(call.input_sha256);
      plugin.calls.push(call);
      return { status: 'transient', raw_text: null, error: 'slow down' };
    }
    return real(call);
  };
  const { store, args } = setup(t, { tasks: 2, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  const out = await runJudging(args);
  assert.equal(out.calls, 12, 'one failure and one success for each of six calls');
  const rec = judgmentFiles(store)[0];
  assert.equal(rec.status, 'ok');
  assert.equal(rec.attempts, 2);
  assert.equal(rec.error, null);
  assert.notEqual(plugin.calls[0].seed, plugin.calls[1].seed, 'a retry gets a new seed');
});

test('a reply core cannot read is stored as unparsable with its text, and the seat is invalid', async (t) => {
  const plugin = scriptedPlugin({ reply: () => 'I prefer the first one.' });
  const { store, args } = setup(t, { tasks: 2, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  const out = await runJudging(args);
  const rec = judgmentFiles(store)[0];
  assert.equal(rec.status, 'unparsable');
  assert.equal(rec.raw_text, 'I prefer the first one.');
  assert.equal(rec.parsed, null);
  assert.match(rec.error, /no JSON object/);
  assert.equal(rec.attempts, MAX_ATTEMPTS);
  assert.deepEqual(Object.values(out.result.result.pairs[0].judge_status), ['invalid', 'invalid', 'invalid']);
});

test('one bad seat among good ones leaves that seat invalid and the pair scored by the rest', async (t) => {
  const plugin = scriptedPlugin({ reply: ({ seatIndex, a, b }) => (seatIndex === 2 ? 'no idea' : overallReply(a, b)) });
  const { args } = setup(t, { tasks: 8, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  const out = await runJudging(args);
  const pair = out.result.result.pairs[0];
  assert.deepEqual(pair.judge_status, { 'seat-1': 'scored', 'seat-2': 'scored', 'seat-3': 'invalid' });
  assert.equal(pair.scored, true, 'two seats are a panel');
  assert.equal(out.result.result.judge_participation.invalid, 8);
});

test('a plugin that answers with a text of the wrong kind is stored as unparsable', async (t) => {
  const plugin = scriptedPlugin();
  plugin.runGrader = () => ({ status: 'ok', raw_text: { winner: 'A' } });
  const { store, args } = setup(t, { tasks: 1, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  await runJudging(args);
  const rec = judgmentFiles(store)[0];
  assert.equal(rec.status, 'unparsable');
  assert.equal(rec.raw_text, null);
  assert.equal(rec.usage, null);
  assert.equal(rec.cost, null);
});

test('an unknown grader status is stored as invalid', async (t) => {
  const plugin = scriptedPlugin({ status: 'weird' });
  const { store, args } = setup(t, { tasks: 1, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  await runJudging(args);
  const rec = judgmentFiles(store)[0];
  assert.equal(rec.status, 'invalid');
  assert.match(rec.error, /unknown grader status "weird"/);
});

test('a task whose pairs are missing or stale is listed and not judged; the rest are', async (t) => {
  const { store, plugin, args } = setup(t, { tasks: 4, pairs: { skip: (task, arm) => task.id === 'task-2' && arm === 'without' } });
  const staleTasks = taskSetOf(4);
  staleTasks.tasks[2] = { ...staleTasks.tasks[2], task: 'The request was edited after the run.' };
  const out = await runJudging({ ...args, taskSet: staleTasks });
  assert.deepEqual(out.missing_pairs, ['task-2', 'task-3']);
  assert.equal(out.complete, false);
  assert.equal(out.result, null);
  assert.equal(out.pending, 2 * 3 * 2);
  assert.equal(out.calls, 2 * 3 * 2, 'tasks 1 and 4 are judged');
  assert.equal(plugin.calls.length, 12);
  assert.deepEqual([...new Set(judgmentFiles(store).map((r) => r.task_id))].sort(), ['task-1', 'task-4']);
  assert.equal(store.readResult(SKILL), null);
});

test('the judge roster, not the code, decides who judges: a roster of two is refused', async (t) => {
  const { plugin, args } = setup(t, { tasks: 1 });
  await assert.rejects(runJudging({ ...args, config: { judges: roster(2) } }), /at least 3 seats/);
  assert.equal(plugin.calls.length, 0);
});

test('the items scale is judged with the checklist length and its own template', async (t) => {
  const plugin = scriptedPlugin({
    reply: ({ a, b }) => JSON.stringify({ items_a: a > b ? ['MET', 'MET'] : ['MISSING', 'MISSING'], items_b: a > b ? ['MISSING', 'MISSING'] : ['MET', 'MET'] }),
  });
  const { store, args } = setup(t, { tasks: 8, plugin, config: configFor('scripted', { ordersPerPair: 1 }) });
  const out = await runJudging({ ...args, scale: 'items' });
  assert.equal(out.complete, true);
  const rec = judgmentFiles(store)[0];
  assert.equal(rec.judge_scale, 'items');
  assert.equal(rec.prompt_version, SCALES.items.promptVersion);
  assert.equal(rec.prompt_sha256, templateForScale('items').sha256);
  assert.equal(out.result.scale, 'items');
  assert.equal(out.result.result.verdict.verdict, 'keep');
});

test('scoreSkill makes no call: incomplete before judging, complete from the store after', async (t) => {
  const { plugin, args } = setup(t, { tasks: 8 });
  const { plugins, ...noPlugins } = args;
  const before = scoreSkill(noPlugins);
  assert.equal(before.complete, false);
  assert.equal(before.pending, 48);
  assert.equal(before.calls, 0);
  assert.equal(before.result, null);
  await runJudging(args);
  const after = scoreSkill(noPlugins);
  assert.equal(after.complete, true);
  assert.equal(after.calls, 0);
  assert.equal(after.result_written, false, 'the stored result is current');
  assert.equal(plugin.calls.length, 48, 'scoring called nothing');
  assert.ok(plugins);
});

test('runJudging requires a store, a task array and a sanitizer context', async (t) => {
  const { args } = setup(t, { tasks: 1 });
  await assert.rejects(runJudging({ ...args, store: undefined }), /needs a store/);
  await assert.rejects(runJudging({ ...args, taskSet: {} }), /taskSet.tasks must be an array/);
  await assert.rejects(runJudging({ ...args, context: undefined }), /sanitize context/);
  await assert.rejects(runJudging({ ...args, skill: '../x' }), /invalid skill/);
  await assert.rejects(runJudging({ ...args, scale: 'vote' }), /unknown judge scale/);
});

// ---- the judge call-site pin --------------------------------------------------------------

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'run', 'judge.js'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const reads = (re) => [...CODE.matchAll(re)].map((m) => m[1]);

test('call-site pin: the prompt is built only through judgePrompt, in one place', () => {
  assert.match(CODE, /const \{ judgePrompt, templateForScale \} = require\('\.\.\/lib\/judge-prompt'\)/);
  assert.equal(reads(/\bjudgePrompt\(/g).length, 1, 'exactly one call of judgePrompt');
  for (const forbidden of ['renderTemplate(', 'wrapForGrader(', 'sanitizeAnswer(', 'cleanAnswer(', 'workspaceChanges(', 'loadTemplate(']) {
    assert.ok(!CODE.includes(forbidden), `${forbidden} would build prompt text outside judgePrompt`);
  }
  assert.ok(!/\bprompt\s*[+]?=\s*[`'"]/.test(CODE) && !/\bprompt\s*\+=/.test(CODE), 'no prompt text is assembled here');
});

test('call-site pin: only the allow-listed task fields and the three pair fields are read', () => {
  const taskFields = new Set(reads(/\btask\.([A-Za-z_]\w*)/g));
  assert.deepEqual([...taskFields].sort(), ['id', 'rubric', 'task'], 'task fields read by the driver');
  const pairFields = new Set(reads(/\bpair\.([A-Za-z_]\w*)/g));
  assert.deepEqual([...pairFields].sort(), ['answer', 'final', 'start'], 'pair fields passed to the prompt');
  for (const field of ['answer', 'start', 'final']) {
    assert.equal(reads(new RegExp(`\\bpair\\.${field}\\b`, 'g')).length, 1, `pair.${field} is read in one place`);
  }
  assert.match(CODE, /const armView = \(pair\) => \(\{ answer: pair\.answer, start: pair\.start, final: pair\.final \}\)/);
  assert.equal(reads(/\barmView\(/g).length, 2, 'both arms go through armView');
});

test('call-site pin: nothing but the request, checklist, replies and changed files reaches the plugin', async (t) => {
  const SENTINELS = ['ZZ-ID-SENTINEL', 'ZZ-SECTION-SENTINEL', 'ZZ-KIND-SENTINEL', 'ZZ-CHECK-SENTINEL', 'ZZ-REFERENCE-SENTINEL', 'ZZ-FIXTURE-SENTINEL', 'ZZ-FINGERPRINT-SENTINEL', 'ZZ-FUTURE-SENTINEL'];
  const { store, args } = setup(t, { tasks: 0 });
  const base = taskSetOf(1).tasks[0];
  const task = {
    ...base,
    id: 'zz-id-sentinel',
    target_section: 'ZZ-SECTION-SENTINEL',
    kind: 'ZZ-KIND-SENTINEL',
    checks: [{ kind: 'contains', path: 'ZZ-CHECK-SENTINEL.md', pattern: 'ZZ-CHECK-SENTINEL' }],
    reference: { 'ZZ-REFERENCE-SENTINEL.md': 'ZZ-REFERENCE-SENTINEL' },
    fixtures: ['ZZ-FIXTURE-SENTINEL.md'],
    unlisted_future_field: 'ZZ-FUTURE-SENTINEL',
  };
  const { makePair } = require('./support/records');
  for (const arm of ['with', 'without']) {
    const rec = makePair({
      taskId: task.id,
      arm,
      request: task.task,
      fingerprint: 'zz-fingerprint-sentinel@1',
      answer: `Reply ${arm === 'with' ? 'ZQHI1' : 'ZQLO1'}.`,
      start: { 'CHANGELOG.md': '# Changelog\n' },
      final: { 'CHANGELOG.md': `# Changelog\n- ${arm === 'with' ? 'ZQHI1' : 'ZQLO1'}\n` },
    });
    store.writePair({ ...rec, extra_run_detail: 'ZZ-FUTURE-SENTINEL' });
  }
  const plugin = scriptedPlugin();
  const out = await runJudging({
    ...args,
    plugins: { scripted: plugin },
    taskSet: { tasks: [task] },
    config: configFor('scripted', { ordersPerPair: 2 }),
  });
  assert.equal(out.complete, true);
  assert.equal(plugin.calls.length, 6);
  for (const call of plugin.calls) {
    for (const secret of SENTINELS) {
      assert.ok(!call.prompt.toLowerCase().includes(secret.toLowerCase()), `${secret} reached the judge prompt`);
    }
    assert.ok(call.prompt.includes(task.task), 'the request is shown');
    assert.ok(call.prompt.includes('1. Names the flag.\n2. Edits the changelog.'), 'the checklist is shown');
    assert.ok(call.prompt.includes('### CHANGELOG.md (edited)'), 'the changed files are shown');
    assert.ok(!call.prompt.includes(task.id), 'the task id stays out');
  }
});
