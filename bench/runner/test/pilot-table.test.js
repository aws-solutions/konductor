// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pilot table (`scenarios pilot-table`) on a fake pack and fake wave directories: every flag, the code score and the CLI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, mkResult } = require('./helpers.js');
const { pilotRows, renderTable, secondFamilyShare } = require('../../scenarios/pilot-table.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const json = (o) => `${JSON.stringify(o, null, 1)}\n`;
const REF = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

// Batch t9: four tasks, one from a second family (25%, under 1 in 3). Batch t8: two tasks, one from each family.
function fakePack(root) {
  const task = (id, model, o = {}) => ({ id, prompt: 'Do it.', fixture: id, hidden: id, authorship: { model }, ...o });
  write(path.join(root, 't9', 't9-easy.json'), json(task('t9-easy', 'gpt-5.6-luna')));
  write(path.join(root, 't9', 't9-hard.json'), json(task('t9-hard', 'gpt-5.6-luna', { pilot: { scores: {}, decision: 'fix', date: '2026-11-19', dryRun: { reference: 80, stub: 0, lazy: 10, alt: 90, date: '2026-11-19' } } })));
  write(path.join(root, 't9', 't9-leak.json'), json(task('t9-leak', 'gpt-5.6-luna')));
  write(path.join(root, 't9', 't9-copy.json'), json(task('t9-copy', 'deepseek-3.2')));
  write(path.join(root, 't9', 'solutions', 't9-copy', 'docs', 'answer.md'), `${REF}\n`);
  write(path.join(root, 't9', 'fixtures', 't9-copy', 'README.md'), 'start\n');
  write(path.join(root, 't8', 't8-a.json'), json(task('t8-a', 'gpt-5.6-luna')));
  write(path.join(root, 't8', 't8-b.json'), json(task('t8-b', 'deepseek-3.2')));
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
  assert.deepEqual(Object.keys(rows['t9-easy#1'].flags).sort(), ['second-family', 'too-easy']);
  assert.deepEqual(rows['t9-easy#1'].loads, ['code-review']);
  assert.match(rows['t9-hard#1'].flags['too-hard'], /reference 80/);
  assert.equal(rows['t9-hard#1'].flags['too-easy'], undefined);
  assert.match(rows['t9-leak#1'].flags.broken, /timeout/);
  assert.match(rows['t9-leak#1'].flags.broken, /did not parse/);
  assert.match(rows['t9-leak#1'].flags['answer-leak'], /hidden\/t9-leak/);
  assert.match(rows['t9-leak#1'].flags['too-hard'], /score 0/);
  assert.match(rows['t9-copy#1'].flags['answer-leak'], /docs\/answer\.md repeats 100%/);
  // t8 has one task of each family: no second-family flag there.
  assert.equal(rows['t8-a#1'].flags['second-family'], undefined);
  assert.match(rows['t8-a#1'].flags.noisy, /check 2 flipped against the dry run/);
  assert.match(rows['t8-b#1'].flags.noisy, /check 2 differs between replicates/);
  assert.match(rows['t8-b#2'].flags.noisy, /differs between replicates/);
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
  assert.match(text, /^\| task \| arm \| rep \| score/);
  assert.match(text, /7 run\(s\), 14\.00 credits/);
  assert.match(text, /Second run for noisy tasks: t8-a,t8-b/);
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
