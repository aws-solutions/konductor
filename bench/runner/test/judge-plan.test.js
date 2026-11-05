// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging, planJudging, estimateSpend, FALLBACK_CREDITS_PER_CALL } = require('../../judge/run.js');
const { runPackJudging, describePackPlan } = require('../../judge/packrun.js');
const { loadPack } = require('../../judge/pack/index.js');
const { loadTasks } = require('../lib/tasks.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const JUDGES = ['gpt-test', 'deepseek-test', 'glm-test'];
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  fs.writeFileSync(path.join(bench, 'tasks/d1.json'), JSON.stringify({ ...t1, id: 'd1', class: 'design', prompt: 'Write a design for the hold service.' }));
  const design = '# Hold service design\n\nThis document says how holds work.\n\n## Testing\n\nTwo returns at once: exactly one hold becomes reserved.\n';
  const runDir = makeRun(path.join(root, 'run'), bench, ['vanilla', 'other'].map((arm) => ({ arm, task: 'd1', finalText: `${arm} done`, files: { 'a.txt': `fixed by ${arm}\n`, 'docs/design.md': design } })), { taskIds: ['d1'] });
  const marker = path.join(root, 'backend-was-called');
  const script = path.join(root, 'judge-that-must-not-run.js');
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'called');process.exit(1);`);
  return { root, bench, runDir, marker, judgeCmd: `${process.execPath} ${script}` };
}

const cli = (s, args) => spawnSync(process.execPath, [BENCH_JS, 'judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', JUDGES.join(','), '--judge-cmd', s.judgeCmd, '--plan', ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR },
});

function assertUntouched(s) {
  assert.equal(fs.existsSync(s.marker), false, 'the backend was invoked');
  for (const f of ['judgments.json', 'judgments-quality.json', 'credits.jsonl']) assert.equal(fs.existsSync(path.join(s.runDir, f)), false, f);
  assert.equal(fs.existsSync(path.join(s.runDir, 'judge')), false, 'no judge scratch or cache');
}

test('judge --plan in rubric mode prints backend, panel, call count and estimate, and invokes no backend', () => {
  const s = setup();
  try {
    const r = cli(s, ['--mode', 'rubric']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /backend: kiro \(a --judge-cmd command/);
    assert.match(r.stdout, /panel: gpt-test, deepseek-test, glm-test \(3 model families\)/);
    assert.match(r.stdout, /calls: 6 \(rubric 6, pairwise 0, graded 0\)/);
    assert.match(r.stdout, /already cached: 0 of 6 \(free\); live calls: 6/);
    assert.match(r.stdout, /estimated spend: about 1\.14 credits for 6 live call\(s\) at 0\.19 credits each/);
    assert.match(r.stdout, /nothing was called and nothing was written/);
    assertUntouched(s);
  } finally { cleanup(s.root); }
});

test('judge --plan counts pairwise and graded calls as two orderings per non-baseline run and judge', () => {
  const s = setup();
  try {
    const pair = cli(s, ['--mode', 'pairwise']);
    assert.equal(pair.status, 0, pair.stderr);
    assert.match(pair.stdout, /calls: 6 \(rubric 0, pairwise 6, graded 0\)/);
    assert.match(pair.stdout, /baseline arm: vanilla/);
    const graded = cli(s, ['--mode', 'graded']);
    assert.match(graded.stdout, /calls: 6 \(rubric 0, pairwise 0, graded 6\)/);
    const all = cli(s, ['--mode', 'rubric,pairwise,graded']);
    assert.match(all.stdout, /calls: 18 \(rubric 6, pairwise 6, graded 6\)/);
    const dflt = cli(s, []);
    assert.match(dflt.stdout, /calls: 12 \(rubric 6, pairwise 6, graded 0\)/);
    assertUntouched(s);
  } finally { cleanup(s.root); }
});

test('judge --plan with the quality pack prints the backend line and invokes no backend', () => {
  const s = setup();
  try {
    const r = cli(s, ['--criteria-pack', 'quality']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /backend: kiro/);
    assert.match(r.stdout, /panel: gpt-test, deepseek-test, glm-test/);
    assert.match(r.stdout, /\d+ judge call\(s\) for \d+ run\(s\) x 3 judge\(s\)/);
    assert.match(r.stdout, /estimated spend: about/);
    assert.match(r.stdout, /nothing was called and nothing was written/);
    assertUntouched(s);
  } finally { cleanup(s.root); }
});

test('judge --plan does not need the kiro login or the opencode credentials file', () => {
  const s = setup();
  try {
    const noCmd = spawnSync(process.execPath, [BENCH_JS, 'judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', JUDGES.join(','), '--mode', 'rubric', '--auth-db', path.join(s.root, 'missing.sqlite3'), '--plan'], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR },
    });
    assert.equal(noCmd.status, 0, noCmd.stderr);
    assert.match(noCmd.stdout, /backend: kiro \(kiro-cli, spend in credits\)/);
    const oc = spawnSync(process.execPath, [BENCH_JS, 'judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', 'deepseek-3.2,glm-5,gpt-5.6-luna', '--mode', 'rubric', '--judge-backend', 'opencode', '--aws-creds-file', path.join(s.root, 'none'), '--plan'], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR },
    });
    assert.equal(oc.status, 0, oc.stderr);
    assert.match(oc.stdout, /backend: opencode \(opencode on Bedrock, spend in USD\)/);
    assert.match(oc.stdout, /estimated spend: unknown: no earlier opencode judging/);
    assertUntouched(s);
  } finally { cleanup(s.root); }
});

test('a real judge pass names the backend and the panel on stderr before any call', () => {
  const s = setup();
  try {
    const script = path.join(s.root, 'ok-judge.js');
    fs.writeFileSync(script, `const p=require('fs').readFileSync(0,'utf8');const ids=[...p.matchAll(/^- id: (\\S+)/gm)].map((m)=>m[1]);console.log(JSON.stringify({criteria:ids.map((id)=>({id,verdict:'pass',evidence:'a.txt'}))}));`);
    const r = spawnSync(process.execPath, [BENCH_JS, 'judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', JUDGES.join(','), '--mode', 'rubric', '--judge-cmd', `${process.execPath} ${script}`], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR },
    });
    assert.equal(r.status, 0, r.stderr);
    const first = r.stderr.split('\n').findIndex((l) => /backend: kiro .*panel: gpt-test, deepseek-test, glm-test/.test(l));
    const firstCall = r.stderr.split('\n').findIndex((l) => /judged rubric/.test(l));
    assert.ok(first >= 0 && first < firstCall, r.stderr);
  } finally { cleanup(s.root); }
});

test('the passes themselves refuse a plan request instead of running', async () => {
  const s = setup();
  const boom = async () => { throw new Error('backend called'); };
  try {
    const common = { runDir: s.runDir, benchDir: s.bench, judges: JUDGES, modes: ['rubric'], baseline: 'vanilla', concurrency: 1, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), caller: boom };
    await assert.rejects(runJudging({ ...common, plan: true }), /cannot honor --plan/);
    await assert.rejects(runPackJudging({ ...common, pack: loadPack('quality'), plan: true }), /cannot honor --plan/);
    assertUntouched(s);
  } finally { cleanup(s.root); }
});

test('the plan functions take no caller: a throwing backend in the options is never reached', () => {
  const s = setup();
  const boom = () => { throw new Error('backend called'); };
  try {
    const o = { runDir: s.runDir, benchDir: s.bench, judges: JUDGES, modes: ['rubric', 'pairwise', 'graded'], baseline: 'vanilla', limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), caller: boom };
    const d = planJudging(o);
    assert.equal(d.calls, 18);
    assert.deepEqual(d.byMode, { rubric: 6, pairwise: 6, graded: 6 });
    const pd = describePackPlan({ run: require('../../report/load.js').loadRun(s.runDir), tasks: loadTasks(s.bench), benchDir: s.bench, limits: o.limits, redactions: o.redactions, thePack: loadPack('quality'), judges: JUDGES, caller: boom });
    assert.ok(pd.calls > 0 && pd.cached === 0 && pd.live === pd.calls);
    assertUntouched(s);
  } finally { cleanup(s.root); }
});

test('the plan counts calls the cache already holds and learns the per-call cost from earlier judging', async () => {
  const s = setup();
  try {
    const caller = async ({ prompt }) => {
      const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
      return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }), credits: 0.5, latencyMs: 1 };
    };
    const o = { runDir: s.runDir, benchDir: s.bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {} };
    await runJudging({ ...o, caller });
    const again = planJudging(o);
    assert.equal(again.calls, 2);
    assert.equal(again.cached, 2);
    assert.equal(again.live, 0);
    assert.equal(again.estimate.total, 0);
    const more = planJudging({ ...o, judges: ['gpt-test', 'deepseek-test'] });
    assert.equal(more.cached, 2);
    assert.equal(more.live, 2);
    assert.ok(Math.abs(more.estimate.perCall - 0.5) < 1e-9);
    assert.ok(Math.abs(more.estimate.total - 1) < 1e-9);
  } finally { cleanup(s.root); }
});

test('the estimate falls back to the documented default when nothing was judged before, and is unknown in USD', () => {
  assert.equal(estimateSpend({ judgments: null, usdMode: false, liveCalls: 23 }).total, 23 * FALLBACK_CREDITS_PER_CALL);
  assert.equal(estimateSpend({ judgments: null, usdMode: true, liveCalls: 23 }).total, null);
  const usd = estimateSpend({ judgments: { invocations: [{ calls: 10, cachedCalls: 2, spentUsd: 0.8 }] }, usdMode: true, liveCalls: 5 });
  assert.equal(usd.unit, 'usd');
  assert.ok(Math.abs(usd.total - 0.5) < 1e-9);
});
