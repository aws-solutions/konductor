// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/lib: the JSON reads the bash scripts used to hold as inline node -e programs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', '..', 'scripts', 'lib');
const study = require(path.join(LIB, 'study.js'));
const judgments = require(path.join(LIB, 'judgments.js'));
const ledger = require(path.join(LIB, 'ledger.js'));
const report = require(path.join(LIB, 'chain-report.js'));
const { writeFields } = require(path.join(LIB, 'plant-seeds.js'));
const { run } = require(path.join(LIB, 'sh.js'));

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-lib-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const put = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };

test('completeState names why a task dir is not complete, and says complete when it is', (t) => {
  const d = tmp(t);
  assert.equal(study.completeState(d, 2, 1), 'no-summary');
  const base = { isolationGate: { ok: true }, armIds: ['a', 'b'], replicates: 1, taskIds: ['x'] };
  put(path.join(d, 'summary.json'), { ...base, interrupted: 'SIGTERM' });
  assert.equal(study.completeState(d, 2, 1), 'interrupted:SIGTERM');
  put(path.join(d, 'summary.json'), { ...base, isolationGate: { ok: false } });
  assert.equal(study.completeState(d, 2, 1), 'isolation-gate-not-ok');
  put(path.join(d, 'summary.json'), base);
  assert.equal(study.completeState(d, 3, 1), 'config-mismatch');
  put(path.join(d, 'summary.json'), { ...base, results: [{}] });
  assert.equal(study.completeState(d, '2', '1'), 'runs:1/2');
  put(path.join(d, 'summary.json'), { ...base, results: [{}, { status: 'budget_skipped' }] });
  assert.equal(study.completeState(d, 2, 1), 'budget-skipped');
  put(path.join(d, 'summary.json'), { ...base, results: [{}, {}] });
  assert.equal(study.completeState(d, 2, 1), 'complete');
});

test('autonomyStats counts autonomy runs only; budgetSkippedTasks leaves out dot dirs', (t) => {
  const d = tmp(t);
  put(path.join(d, 'arm', 'autonomy-1', 'r1', 'result.json'), { taskId: 'autonomy-1', askedUser: true, turns: 2 });
  put(path.join(d, 'arm', 'autonomy-1', 'r2', 'result.json'), { taskId: 'autonomy-1', turns: 1 });
  put(path.join(d, 'arm', 'real-1', 'r1', 'result.json'), { taskId: 'real-1', askedUser: true, status: 'budget_skipped' });
  put(path.join(d, '.old', 'real-2', 'r1', 'result.json'), { taskId: 'real-2', status: 'budget_skipped' });
  put(path.join(d, 'arm', 'bad', 'r1', 'result.json'), '{torn');
  assert.equal(study.autonomyStats([d]), 'runs=2 askedUser=1 secondTurn=1');
  assert.deepEqual(study.budgetSkippedTasks(d), ['real-1']);
  assert.equal(study.resultFiles(d).length, 5);
  assert.equal(study.resultFiles(d, { skipHidden: true }).length, 4);
});

test('judgments: backend, error counts, and the two print forms', (t) => {
  const d = tmp(t);
  const f = path.join(d, 'judgments.json');
  assert.equal(judgments.backend(f), null);
  assert.equal(run('backend', [f]), 'unreadable');
  assert.equal(run('judgeinfo', [f]), 'unreadable 0 0 0');
  assert.equal(run('cellerrors', [f]), 'unreadable 0 0');
  put(f, { rubric: [{ judgeError: 'ExpiredToken' }, {}], pairwise: [{ judgeError: 'budget reached' }], graded: [{ judgeError: 'bad json' }], notJudged: [1, 2] });
  assert.equal(judgments.backend(f), 'kiro');
  assert.deepEqual(judgments.errorInfo(f), { errors: 3, credErrors: 1, budgetSkipped: 1, notJudged: 2, spentUsd: null });
  assert.equal(run('judgeinfo', [f]), '3 1 1 0');
  assert.equal(run('cellerrors', [f]), '3 1 2');
  put(f, { backend: 'opencode', spentUsd: 1.5 });
  assert.equal(run('backend', [f]), 'opencode');
  assert.equal(run('judgeinfo', [f]), '0 0 0 1.5000');
});

test('ledger: study credits walk every ledger, judge sums skip cached calls, torn lines are left out', (t) => {
  const d = tmp(t);
  const lines = (...xs) => xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
  put(path.join(d, 'a', 'credit-ledger.jsonl'), lines({ kind: 'run', charged: 2.5 }, { kind: 'run', credits: 1 }, '{torn'));
  put(path.join(d, 'b', 'c', 'credit-ledger.jsonl'), lines({ kind: 'judge', usd: 0.25, ok: true }, { kind: 'judge', usd: 9, cached: true, ok: true }, { kind: 'judge', ok: false }));
  assert.deepEqual(ledger.studyCredits([d]), { credits: 3.5, runs: 2, judgeUsd: 0.25, judgeCalls: 1 });
  assert.equal(run('credits', [d]), '3.50 2 0.2500 1');
  assert.equal(run('credits', [path.join(d, 'none')]), '0.00 0 0.0000 0');
  assert.equal(run('judgeledger', [path.join(d, 'b', 'c', 'credit-ledger.jsonl')]), '3 ledger entries, 2 ok, live spend $0.2500');
});

test('chain report: decisions in order with the controls line, and the judging summary', (t) => {
  const d = tmp(t);
  const f = path.join(d, 'decisions.json');
  assert.equal(report.decisionsText(f), 'unreadable');
  put(f, { decisions: [{ name: 'b', decision: 'KEEP', confidence: 'high' }, { name: 'a', decision: 'KEEP', confidence: 'low' }, { name: 'z', decision: 'DELETE', confidence: 'mid' }], controls: { trusted: false } });
  assert.equal(report.decisionsText(f), 'DELETE=1 PRUNE=0 KEEP=2 NEEDS DATA=0\n  z: DELETE (mid)\n  a: KEEP (low)\n  b: KEEP (high)\ncontrols: FAILED');
  const V = path.join(d, 'V'), RJ = path.join(V, 'reports-judged');
  put(path.join(V, 'real-1', 'summary.json'), {});
  put(path.join(V, 'real-1', 'judgments.json'), { spentUsd: 0.5, invocations: [{ calls: 3, cachedCalls: 1 }], rubric: [{ judgeError: 'x', parseFailures: 2 }] });
  put(path.join(V, 'pilot-1', 'summary.json'), {});
  put(path.join(RJ, 'platform', 'verdict.json'), { arms: [{ label: 'k', verdict: 'better', aaRepeatOf: 'v' }] });
  const s = report.pilotSummary(V, RJ, new Date('2026-01-01T00:00:00Z'));
  assert.match(s, /^Capability study judging summary, generated 2026-01-01T00:00:00.000Z\n/);
  assert.match(s, /- pilot-1: judgments.json missing, not judged\n- real-1: spent \$0.5000 over 1 invocation\(s\), calls 3 \(1 cached\), parse failures 2, judge errors 1, not judged 0\n/);
  assert.match(s, /Total judge spend \(sum of the per-dir figures\): \$0.5000/);
  assert.match(s, /report missing: pass\/orchestrator-pass.json/);
  assert.match(s, /- k \| better \(A\/A repeat of v\)/);
  assert.ok(s.endsWith(`- ${path.join(RJ, 'platform')}/`));
});

test('plant seeds: one six-digit seed per task json and the kiro-cli pin', (t) => {
  const d = tmp(t);
  put(path.join(d, 'tasks', 'a.json'), '{}');
  put(path.join(d, 'tasks', 'b.json'), '{}');
  put(path.join(d, 'tasks', 'notes.txt'), '');
  const out = path.join(d, 'fields.json');
  const f = writeFields({ tasksDir: path.join(d, 'tasks'), out, version: '2.0.1', sha256: 'ab', rng: () => 0.5 });
  assert.deepEqual(f, { seeds: { a: 550000, b: 550000 }, versions: { kiroCli: { version: '2.0.1', sha256: 'ab', engine: 'v3' } } });
  assert.equal(fs.readFileSync(out, 'utf8'), `${JSON.stringify(f, null, 1)}\n`);
  const r = writeFields({ tasksDir: path.join(d, 'tasks'), out, version: 'v', sha256: 's' });
  for (const v of Object.values(r.seeds)) assert.ok(v >= 100000 && v <= 999999);
});

test('sh.js skipped and retry print what pilot-wave.sh reads', (t) => {
  const d = tmp(t);
  put(path.join(d, 'arm', 't1', 'r1', 'result.json'), { taskId: 't1', status: 'budget_skipped' });
  put(path.join(d, 'arm', 't2', 'r1', 'result.json'), { taskId: 't2', status: 'budget_skipped' });
  assert.equal(run('skipped', [d]), 't1,t2');
  const r = spawnSync('bash', ['-c', `read -r left tasks < <(node ${JSON.stringify(path.join(LIB, 'sh.js'))} retry "$1" 40 || echo 0) || true; printf '%s|%s' "$left" "$tasks"`, '_', path.join(d, 'none')], { encoding: 'utf8' });
  assert.match(r.stdout, /^\d+\|$/, r.stderr);
});

test('every lib/sh.js command a script calls exists, and no script under bench/scripts keeps inline node -e outside the waiting list', () => {
  const dir = path.join(LIB, '..');
  const { COMMANDS } = require(path.join(LIB, 'sh.js'));
  // shortcut: run-real-pilot.sh keeps its helper until FW-2 (the spend guard, another session's files) lands.
  const waiting = new Set(['run-real-pilot.sh']);
  let calls = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sh'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (waiting.has(f)) continue;
    assert.doesNotMatch(text, /node -e/, `${f} still holds inline node -e`);
    for (const m of text.matchAll(/(?:\bhj|lib\/sh\.js"?) ([a-z]+)\b/g)) {
      assert.ok(COMMANDS[m[1]], `${f} calls sh.js ${m[1]}, which does not exist`);
      calls++;
    }
  }
  assert.ok(calls >= 6, `only ${calls} sh.js calls found`);
});

test('bench_strict: the first failing command stops the script and says where; $( ) and conditions stay quiet', (t) => {
  const d = tmp(t);
  const stateDir = path.join(LIB, '..', 'state-dir.sh');
  const f = path.join(d, 'strict.sh');
  put(f, `. ${JSON.stringify(stateDir)}\nbench_strict\nx=$(false; echo y)\nif false; then :; fi\nf() { [ -n "" ] && echo no; }\nf || echo "f failed quietly"\nfalse\necho not-reached\n`);
  const r = spawnSync('bash', [f], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'f failed quietly\n');
  assert.equal(r.stderr, 'strict.sh: line 7: exit 1: false (stopped by set -e)\n');
  // shortcut: run-real-pilot.sh gets bench_strict with FW-2 (another session owns its spend lines).
  for (const s of ['monitor.sh', 'run-judging.sh', 'run-skill-bench.sh', 'run-after-capability.sh']) {
    assert.match(fs.readFileSync(path.join(LIB, '..', s), 'utf8'), /state-dir\.sh"\n(?:#.*\n)*bench_strict\n/, `${s} calls bench_strict right after sourcing state-dir.sh`);
  }
});

test('sh.js smoke and jsummary print what run-judging.sh reads', (t) => {
  const d = tmp(t);
  const out = path.join(d, 'smoke.txt');
  put(out, 'noise\n{"model":"a"}\n{"model":"b","error":"denied"}\n{"model":"c","jsonOk":false}\n');
  assert.deepEqual(run('smoke', [out, '0', 'a']), { text: 'OK a', code: 0 });
  assert.deepEqual(run('smoke', [out, '0', '']), { text: 'OK a\nFAIL b: denied | c: reply was not valid JSON', code: 1 });
  assert.deepEqual(run('smoke', [out, '2', 'a z']), { text: 'OK a\nFAIL z: no result printed | smoke script exit status 2', code: 1 });
  const r = spawnSync(process.execPath, [path.join(LIB, 'sh.js'), 'smoke', out, '0', 'b'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'FAIL b: denied\n');
  const study = path.join(d, 'S'), rj = path.join(study, 'reports-judged');
  put(path.join(study, 'claude', 'judgments.json'), { backend: 'opencode', subjectModel: 'm', judges: ['j1'], spentUsd: 1, spentUsdByJudge: { j1: 1 }, invocations: [{ calls: 2, cachedCalls: 1 }], rubric: [{ judge: 'j1', judgeError: 'x' }] });
  put(path.join(rj, 'platform-claude', 'verdict.json'), { arms: [{ label: 'k', verdict: 'same' }] });
  const s = run('jsummary', [study, rj, 'claude=0;gpt=not-run;', '15', 'claude gpt']);
  assert.match(s, /^Judging summary, generated \d{4}-/);
  assert.match(s, /Budget cap per cell and command: \$15/);
  assert.match(s, /- claude: judge exit status 0\n    backend opencode, subject m, judges j1\n    spent \$1\.0000 over 1 invocation\(s\) \(j1 \$1\.0000\)\n    calls 2 \(1 served from cache\), records: 1 rubric, 0 pairwise, 0 graded\n    parse failures 0, judge errors 1 \(j1 1\), runs not judged 0\n    judge errors were not cached/);
  assert.match(s, /- gpt: judge exit status not-run\n    judgments.json missing or unreadable/);
  assert.match(s, /claude:\n- k \| same\ngpt:\n    report missing/);
});

test('the sh.js command line: prints each answer on one line, exit 3 when the repo has no hygiene scanner, 64 on an unknown command', (t) => {
  const d = tmp(t);
  const sh = (...a) => spawnSync(process.execPath, [path.join(LIB, 'sh.js'), ...a], { encoding: 'utf8' });
  assert.equal(sh('nope').status, 64);
  const msg = path.join(d, 'msg');
  put(msg, 'bench: a plain message\n');
  assert.equal(sh('marker', d, msg).status, 3);
  const r = sh('marker', path.join(__dirname, '..', '..', '..'), msg);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(sh('credits', d).stdout, '0.00 0 0.0000 0\n');
});
