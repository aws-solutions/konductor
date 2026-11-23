// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pilot table (`scenarios pilot-table`) on a fake pack and fake wave directories: every flag, the code score and the CLI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, mkResult } = require('./helpers.js');
const { pilotRows, renderTable, secondFamilyShare, batchSummary } = require('../../scenarios/pilot-table.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const json = (o) => `${JSON.stringify(o, null, 1)}\n`;
const REF = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

// Batch t9: four tasks, one from a second family (25%, under 1 in 3). Batch t8: two tasks, one from each family.
function fakePack(root) {
  const task = (id, model, o = {}) => ({ id, prompt: 'Do it.', fixture: id, hidden: id, authorship: { model }, ...o });
  write(path.join(root, 't9', 't9-easy.json'), json(task('t9-easy', 'gpt-5.6-luna', { handEdited: { family: 'claude', editor: 'lead', log: 'HAND-EDITS.md' } })));
  write(path.join(root, 't9', 't9-hard.json'), json(task('t9-hard', 'gpt-5.6-luna', { pilot: { scores: {}, decision: 'keep', date: '2026-11-19', dryRun: { reference: 80, stub: 0, lazy: 55, alt: 90, date: '2026-11-19' } } })));
  write(path.join(root, 't9', 't9-leak.json'), json(task('t9-leak', 'gpt-5.6-luna', { authorship: { model: 'gpt-5.6-luna', singleFamily: true } })));
  write(path.join(root, 't9', 't9-copy.json'), json(task('t9-copy', 'deepseek-3.2')));
  write(path.join(root, 't9', 'solutions', 't9-copy', 'docs', 'answer.md'), `${REF}\n`);
  write(path.join(root, 't9', 'fixtures', 't9-copy', 'README.md'), 'start\n');
  write(path.join(root, 't8', 't8-a.json'), json(task('t8-a', 'gpt-5.6-luna', { handEdited: { family: 'claude' }, review: { recheck: { family: 'glm', date: '2026-11-20' } } })));
  // t8-b carries the shared dry run's per-check record instead: reference and stub both passed check 2 (D-88).
  write(path.join(root, 't8', 't8-b.json'), json(task('t8-b', 'deepseek-3.2', { pilot: { scores: {}, decision: 'keep', date: '2026-11-21', dryRun: { reference: 100, stub: 5, lazy: 20, alt: 100, checks: { reference: [true, true], stub: [false, true] }, date: '2026-11-21' } } })));
  // A per-check dry run where reference and stub both passed check 2 (insensitive): a fail there is a flip.
  write(path.join(root, 't8', 'authoring', 't8-a', 'dry-run.json'), json({ reference: { checks: ['pass tests 3/3', 'pass fixture_unchanged'] }, stub: { checks: ['FAIL tests 0/3', 'pass fixture_unchanged'] } }));
}

const tests = (passed, total, o = {}) => ({ type: 'tests', passed: passed === total, tests: { passed, total, ...o } });
const sub = (passed) => ({ type: 'cmd', kind: 'substance', passed });

function fakeRun(dir, specs) {
  for (const s of specs) {
    const runDir = path.join(dir, 'vanilla', s.task, String(s.rep ?? 1));
    write(path.join(runDir, 'result.json'), json(mkResult({ harness: 'kiro-cli', taskId: s.task, replicate: s.rep ?? 1, creditsCharged: 2, wallClockMs: 120000, ...s.result })));
    if (s.stream) write(path.join(runDir, 'stream.jsonl'), s.stream.map((e) => JSON.stringify(e)).join('\n'));
    for (const [rel, text] of Object.entries(s.files || {})) write(path.join(runDir, 'workspace', rel), text);
  }
}

const call = (command) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: command, title: 'execute_bash', rawInput: { command } } } });

function setup() {
  const root = tmp();
  const pack = path.join(root, 'pack');
  fakePack(pack);
  const w1 = path.join(root, 'w1');
  const w2 = path.join(root, 'w2');
  fakeRun(w1, [
    { task: 't9-easy', result: { checks: [tests(10, 10), sub(true)], skillsLoaded: ['code-review'] } },
    { task: 't9-hard', result: { checks: [tests(5, 10), sub(true)] } },
    { task: 't9-leak', result: { status: 'timeout', checks: [tests(0, 4, { unparsed: true }), sub(false)] }, stream: [call('cat ../hidden/t9-leak/hidden/check.test.js'), call('ls')] },
    { task: 't9-copy', result: { checks: [tests(4, 8), sub(true)] }, files: { 'docs/answer.md': `${REF}\n` } },
    { task: 't8-a', result: { checks: [tests(2, 3), { type: 'fixture_unchanged', kind: 'substance', passed: false }] } },
    { task: 't8-b', result: { checks: [tests(1, 4), sub(false)] } },
  ]);
  fakeRun(w2, [{ task: 't8-b', rep: 2, result: { checks: [tests(1, 4), sub(true)] } }]);
  return { root, pack, w1, w2 };
}

const byTask = (rows) => Object.fromEntries(rows.map((r) => [`${r.task}#${r.rep}`, r]));

test('each flag fires on the run that earns it and on no other', () => {
  const { pack, w1, w2 } = setup();
  const rows = byTask(pilotRows([w1, w2], { packDir: pack }));
  assert.deepEqual(Object.keys(rows['t9-easy#1'].flags).sort(), ['hand-edited, recheck missing', 'second-family', 'too-easy']);
  assert.equal(rows['t9-easy#1'].handEdited, 'claude');
  assert.equal(rows['t9-hard#1'].handEdited, 'no');
  // A hand-edited task with its re-check recorded is not flagged.
  assert.equal(rows['t8-a#1'].flags['hand-edited, recheck missing'], undefined);
  assert.equal(rows['t8-a#1'].handEdited, 'claude');
  assert.deepEqual(rows['t9-easy#1'].loads, ['code-review']);
  assert.match(rows['t9-hard#1'].flags['too-hard'], /reference 80/);
  assert.match(rows['t9-hard#1'].flags.fix, /lazy 55 over 40/);
  assert.equal(rows['t9-easy#1'].flags.fix, undefined);
  // A task the owner keeps single-family shows it in its column, not as the second-family flag.
  assert.equal(rows['t9-leak#1'].singleFamily, 'single-family-authored');
  assert.equal(rows['t9-leak#1'].flags['second-family'], undefined);
  assert.equal(rows['t9-hard#1'].singleFamily, '-');
  assert.equal(rows['t9-hard#1'].flags['too-easy'], undefined);
  assert.match(rows['t9-leak#1'].flags.broken, /timeout/);
  assert.match(rows['t9-leak#1'].flags.broken, /did not parse/);
  assert.match(rows['t9-leak#1'].flags['answer-leak'], /hidden\/t9-leak/);
  assert.match(rows['t9-leak#1'].flags['too-hard'], /score 0/);
  assert.match(rows['t9-copy#1'].flags['answer-leak'], /docs\/answer\.md repeats 100%/);
  // t8 has one task of each family: no second-family flag there.
  assert.equal(rows['t8-a#1'].flags['second-family'], undefined);
  assert.match(rows['t8-a#1'].flags.noisy, /check 2 flipped against the dry run/);
  assert.match(rows['t8-b#1'].flags.noisy, /check 2 differs between replicates; check 2 flipped against the dry run/, 'read from pilot.dryRun.checks');
  assert.match(rows['t8-b#2'].flags.noisy, /differs between replicates/);
});

test('each run carries the within-task sd of its task and arm; over 20 marks the task noisy; the table has an sd column (FW-35, D-229)', () => {
  const { pack, w1, w2 } = setup();
  const rows = byTask(pilotRows([w1, w2], { packDir: pack }));
  // t8-b: 17.86 and 46.43, sample sd 20.2.
  const want = Math.abs(((0.125 + 0.2) / 0.7) * 100 - (0.125 / 0.7) * 100) / Math.SQRT2;
  assert.ok(Math.abs(rows['t8-b#1'].sd - want) < 1e-9);
  assert.equal(rows['t8-b#2'].sd, rows['t8-b#1'].sd);
  assert.match(rows['t8-b#1'].flags.noisy, /within-task sd 20\.2 over 20/);
  assert.equal(rows['t9-easy#1'].sd, null, 'one run has no sd');
  assert.doesNotMatch(rows['t8-a#1'].flags.noisy, /within-task sd/);
  const text = renderTable(Object.values(rows));
  assert.match(text, /^\| task \| arm \| rep \| handEdited \| singleFamily \| score \| sd \|/m);
  assert.match(text, /^\| t8-b \| vanilla \| 1 \| no \| - \| 18 \| 20\.2 \|/m);
  assert.match(text, /^\| t9-easy \| vanilla \| 1 \| claude \| - \| 100 \| n\/a \|/m);
});

test('the score is the code-scored part: hidden tests 0.5 and substance checks 0.2, renormalised', () => {
  const { pack, w1 } = setup();
  const rows = byTask(pilotRows([w1], { packDir: pack }));
  assert.equal(rows['t9-easy#1'].score, 100);
  assert.ok(Math.abs(rows['t9-hard#1'].score - ((0.5 * 0.5 + 0.2) / 0.7) * 100) < 1e-9);
  assert.equal(rows['t9-easy#1'].sec, 120);
  assert.equal(rows['t9-easy#1'].credits, 2);
});

test('the table lists every run, the totals and the tasks that need a second run', () => {
  const { pack, w1, w2 } = setup();
  const text = renderTable(pilotRows([w1, w2], { packDir: pack }));
  assert.match(text, /^\| task \| arm \| rep \| handEdited \| singleFamily \| score/);
  assert.match(text, /hand-edited with no re-check 1\./);
  assert.match(text, /7 run\(s\), 14\.00 credits/);
  assert.match(text, /Second run for noisy tasks: t8-a,t8-b/);
  assert.match(text, /script-made copies of the reference, not independent attempts/);
  assert.match(text, /For T4 code tasks the shallow answer equals the empty answer, so the shallow gate says nothing there/);
});

test('the batch summary counts runs, distinct tasks and flagged tasks per batch, and sums to the whole table', () => {
  const { pack, w1, w2 } = setup();
  const rows = pilotRows([w1, w2], { packDir: pack });
  const sum = batchSummary(rows);
  assert.deepEqual(sum.map((s) => s.batch), [...new Set(rows.map((r) => r.batch))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  assert.equal(sum.reduce((n, s) => n + s.runs, 0), rows.length);
  for (const s of sum) {
    const own = rows.filter((r) => r.batch === s.batch);
    assert.equal(s.tasks, new Set(own.map((r) => r.task)).size);
    assert.equal(s.flagged.noisy, new Set(own.filter((r) => r.flags.noisy).map((r) => r.task)).size);
  }
  assert.match(renderTable(rows), /^\| batch \| runs \| budget_skipped \(runs\) \| tasks \| broken \(tasks\)/m);
});

test('secondFamilyShare is the share outside the most common family', () => {
  assert.equal(secondFamilyShare(['gpt', 'gpt', 'gpt']), 0);
  assert.equal(secondFamilyShare(['gpt', 'deepseek', 'gpt', 'gpt']), 0.25);
  assert.equal(secondFamilyShare([]), null);
});

test('bench.js scenarios pilot-table prints the table and refuses no directory', () => {
  const { pack, w1 } = setup();
  const ok = spawnSync(process.execPath, [BENCH_JS, 'scenarios', 'pilot-table', w1, '--pack', pack], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /t9-copy/);
  const none = spawnSync(process.execPath, [BENCH_JS, 'scenarios', 'pilot-table'], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /needs the wave directories/);
});

test('a fix that only deletes fixture lines is not an answer leak when the agent makes the same deletion', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  const lines = Array.from({ length: 40 }, (_, i) => `line${i} alpha${i} beta${i} gamma${i}`);
  const fixture = `${lines.join('\n')}\n`;
  const fixed = `${lines.filter((_, i) => i % 7 !== 3).join('\n')}\n`; // the fix removes six lines, adds none
  write(path.join(pack, 't9', 't9-del.json'), json({ id: 't9-del', prompt: 'Do it.', fixture: 't9-del', hidden: 't9-del', authorship: { model: 'gpt-5.6-luna' } }));
  write(path.join(pack, 't9', 'fixtures', 't9-del', 'test', 'helpers.js'), fixture);
  write(path.join(pack, 't9', 'solutions', 't9-del', 'test', 'helpers.js'), fixed);
  const w = path.join(root, 'w');
  fakeRun(w, [{ task: 't9-del', result: { checks: [tests(8, 8), sub(true)] }, files: { 'test/helpers.js': fixed } }]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  assert.equal(rows['t9-del#1'].flags['answer-leak'], undefined);
});

test('a negative control that repeats its reference is not an answer leak; a hidden-path read still is', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  write(path.join(pack, 't6', 't6-neg.json'), json({ id: 't6-neg', prompt: 'Do it.', fixture: 't6-neg', hidden: 't6-neg', controlKind: 'negative', authorship: { model: 'gpt-5.6-luna' } }));
  write(path.join(pack, 't6', 'solutions', 't6-neg', 'docs', 'answer.md'), `${REF}\n`);
  write(path.join(pack, 't6', 'fixtures', 't6-neg', 'README.md'), 'start\n');
  const w = path.join(root, 'w');
  fakeRun(w, [
    { task: 't6-neg', result: { checks: [tests(8, 8), sub(true)] }, files: { 'docs/answer.md': `${REF}\n` } },
    { task: 't6-neg', rep: 2, result: { checks: [tests(8, 8), sub(true)] }, files: { 'docs/answer.md': `${REF}\n` }, stream: [call('cat ../hidden/t6-neg/check.test.js')] },
  ]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  assert.equal(rows['t6-neg#1'].flags['answer-leak'], undefined);
  assert.match(rows['t6-neg#2'].flags['answer-leak'], /hidden\/t6-neg/);
});

test('a run the service throttled gets its own throttled flag, is not broken and raises no too-hard flag (D-138)', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  write(path.join(pack, 't6', 't6-req.json'), json({ id: 't6-req', prompt: 'Do it.', fixture: 't6-req', hidden: 't6-req', authorship: { model: 'gpt-5.6-luna' } }));
  const w = path.join(root, 'w');
  const throttle = { type: 'runError', data: { stage: 'prompt', message: "You're sending requests faster than your rate limit allows. {\"errorType\":\"ClientThrottleError\"}" } };
  fakeRun(w, [
    { task: 't6-req', result: { status: 'error', checks: [tests(0, 8), sub(false)] }, stream: [throttle] },
    { task: 't6-req', rep: 2, result: { status: 'error', flags: ['throttled'], checks: [tests(0, 8), sub(false)] } },
  ]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  for (const k of ['t6-req#1', 't6-req#2']) {
    assert.match(rows[k].flags.throttled, /error: refused by the model service, rerun it/);
    assert.equal(rows[k].flags.broken, undefined);
    assert.equal(rows[k].flags['too-hard'], undefined);
  }
});

test('writing the output path the task names (answers/x.json) is not an answer leak; another answers/ path still is', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  write(path.join(pack, 't8', 't8-out.json'), json({ id: 't8-out', prompt: 'Write exactly one file at answers/prod-debug.json.', fixture: 't8-out', hidden: 't8-out', checks: [{ type: 'file_exists', path: 'answers/prod-debug.json' }], authorship: { model: 'gpt-5.6-luna' } }));
  const w = path.join(root, 'w');
  fakeRun(w, [
    { task: 't8-out', result: { checks: [tests(4, 4), sub(true)] }, stream: [call("mkdir -p answers && printf '[]' > answers/prod-debug.json")] },
    { task: 't8-out', rep: 2, result: { checks: [tests(4, 4), sub(true)] }, stream: [call('cat ../answers/t8-out/key.json')] },
  ]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  assert.equal(rows['t8-out#1'].flags['answer-leak'], undefined);
  assert.match(rows['t8-out#2'].flags['answer-leak'], /answers\/t8-out/);
});

test('a merge task whose fixture branches already hold the reference lines is not an answer leak', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  const fix = path.join(pack, 't11', 'fixtures', 't11-merge');
  write(path.join(pack, 't11', 't11-merge.json'), json({ id: 't11-merge', prompt: 'Merge the branch.', fixture: 't11-merge', hidden: 't11-merge', authorship: { model: 'gpt-5.6-luna' } }));
  write(path.join(fix, 'cfg.txt'), 'start\n');
  const git = (...a) => spawnSync('git', ['-C', fix, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  write(path.join(fix, 'cfg.txt'), `start\n${REF}\n`);
  git('commit', '-qam', 'feature');
  git('checkout', '-q', 'main');
  require('node:fs').renameSync(path.join(fix, '.git'), path.join(fix, 'dotgit'));
  write(path.join(pack, 't11', 'solutions', 't11-merge', 'cfg.txt'), `start\n${REF}\n`);
  const w = path.join(root, 'w');
  fakeRun(w, [{ task: 't11-merge', result: { checks: [tests(4, 8), sub(true)] }, files: { 'cfg.txt': `start\n${REF}\n` } }]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  assert.equal(rows['t11-merge#1'].flags['answer-leak'], undefined);
});

test('in a merge task, a copy of reference text that is on no fixture branch is still an answer leak', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  const fix = path.join(pack, 't11', 'fixtures', 't11-merge2');
  write(path.join(pack, 't11', 't11-merge2.json'), json({ id: 't11-merge2', prompt: 'Merge the branch.', fixture: 't11-merge2', hidden: 't11-merge2', authorship: { model: 'gpt-5.6-luna' } }));
  write(path.join(fix, 'cfg.txt'), 'start\n');
  const git = (...a) => spawnSync('git', ['-C', fix, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  const branch = Array.from({ length: 30 }, (_, i) => `branch${i} keep${i} this${i} line${i}`);
  write(path.join(fix, 'cfg.txt'), `start\n${branch.join('\n')}\n`);
  git('commit', '-qam', 'feature');
  git('checkout', '-q', 'main');
  require('node:fs').renameSync(path.join(fix, '.git'), path.join(fix, 'dotgit'));
  // The merge logic file puts a short block of its own after some branch lines, as t11-merge-pricing-branches'
  // pricing.js does. Shingles of the own blocks joined up also span blocks that are never next to each other, and a
  // copy cannot hold those: before the fix a full copy scored 45% here and was not flagged.
  const own = (b) => Array.from({ length: 5 }, (_, j) => `own${b}x${j} merge${b}x${j} rule${b}x${j} step${b}x${j}`).join('\n');
  const merged = `start\n${branch.map((l, i) => (i % 3 === 0 ? `${l}\n${own(i)}` : l)).join('\n')}\n`;
  write(path.join(pack, 't11', 'solutions', 't11-merge2', 'cfg.txt'), merged);
  const w = path.join(root, 'w');
  fakeRun(w, [{ task: 't11-merge2', result: { checks: [tests(4, 8), sub(true)] }, files: { 'cfg.txt': merged } }]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  assert.match(rows['t11-merge2#1'].flags['answer-leak'], /cfg\.txt repeats/);
});

test('a played solution (PLAY.json step folders) is compared at the workspace path without the step prefix (D-148)', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  write(path.join(pack, 't12', 't12-mux.json'), json({ id: 't12-mux', prompt: 'Do it.', fixture: 't12-mux', hidden: 't12-mux', authorship: { model: 'gpt-5.6-luna' } }));
  write(path.join(pack, 't12', 'fixtures', 't12-mux', 'src', 'inventory.js'), 'module.exports = {};\n');
  write(path.join(pack, 't12', 'solutions', 't12-mux', 'PLAY.json'), json({ workers: [{ branch: 'mux-1', steps: ['MUX-1'] }] }));
  write(path.join(pack, 't12', 'solutions', 't12-mux', 'MUX-1', 'src', 'inventory.js'), `${REF}\n`);
  const w = path.join(root, 'w');
  fakeRun(w, [
    { task: 't12-mux', result: { checks: [tests(4, 8), sub(true)] }, files: { 'src/inventory.js': `${REF}\n` } },
    { task: 't12-mux', rep: 2, result: { checks: [tests(4, 8), sub(true)] }, files: { 'src/inventory.js': 'module.exports = { own: true };\n' } },
  ]);
  const rows = byTask(pilotRows([w], { packDir: pack }));
  assert.match(rows['t12-mux#1'].flags['answer-leak'], /src\/inventory\.js repeats 100% of the reference \(step MUX-1\)/);
  assert.equal(rows['t12-mux#2'].flags['answer-leak'], undefined);
});
