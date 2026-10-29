// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { runJudging } = require('../../judge/run.js');
const { buildBundle } = require('../../judge/bundle.js');
const { DEFAULT_REDACTIONS, compileRedactions, redact } = require('../../judge/redact.js');
const { resolveJudges, DEFAULT_JUDGES } = require('../eval-commands.js');
const { loadSuite, loadTasks } = require('../lib/tasks.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const REAL_BENCH = path.join(__dirname, '..', '..');
const FAKE = `node ${path.join(__dirname, 'fake-judge.js')}`;
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('timed out waiting');
}

const reply = (prompt, evidence = 'a.txt', verdict = 'pass') => {
  const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
  return !prompt.includes('=== RESPONSE A ===')
    ? JSON.stringify({ criteria: ids.map((id) => ({ id, verdict, evidence })) })
    : JSON.stringify({ winner: 'A', reason: 'r' });
};
const stub = (handler = (c) => reply(c.prompt)) => {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const out = handler({ model, prompt, n: calls.length - 1 });
    return typeof out === 'string' ? { text: out, credits: 0.1, latencyMs: 10 } : { text: '', credits: 0, latencyMs: 10, ...out };
  };
  fn.calls = calls;
  return fn;
};

function fixture(specs, config) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, specs, config);
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, bench, runDir, common };
}

// N4
test('bundle keeps .kiro/specs deliverables and skips only tool state', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{
      arm: 'v1.2.0',
      files: {
        '.kiro/specs/x/requirements.md': '# Requirements\n1. WHEN a hold expires THEN the system SHALL release it.\n',
        '.kiro/agents/konductor.json': '{"tool":"state"}', '.kiro/steering/rules.md': 'steer', '.kiro/skills/s/SKILL.md': 'skill',
        '.kiro/settings/mcp.json': '{}', '.kiro/sessions/cli/1.json': '{}', '.konductor/memory.json': '{}',
      },
    }]);
    const dir = path.join(runDir, 'v1.2.0/t1/1');
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const { text, meta } = buildBundle({
      runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS),
    });
    assert.match(text, /### \.kiro\/specs\/x\/requirements\.md \(created\)/);
    assert.match(text, /WHEN a hold expires THEN the system SHALL release it/);
    assert.doesNotMatch(text, /konductor\.json|rules\.md|SKILL\.md|mcp\.json|sessions|memory\.json/);
    assert.equal(meta.excluded >= 5, true);
  } finally { rm(root); }
});

// S4
test('redaction deletes the phrase: no marker survives and tell-tales go, deliverable paths stay', () => {
  const rules = compileRedactions(DEFAULT_REDACTIONS);
  const input = [
    'I used the skills MCP and loaded the backend skill, then followed the SOP (sop-plan) with a maker-checker pass.',
    'The researcher agent and the k-developer agent read AGENTS.md and the steering files, then delegated to a subagent.',
    'See .kiro/specs and wrote .kiro/specs/hold/requirements.md plus src/sop-notes.md. konductor v1.2.0.',
    '    indented  code   keeps its spacing',
  ].join('\n');
  const { text, fired } = redact(input, rules);
  assert.doesNotMatch(text, /\[(agent|tool|redacted|version)\]/);
  assert.doesNotMatch(text, /\bskills?\b|\bSOP\b|sop-plan|maker-checker|researcher agent|AGENTS\.md|steering|subagent|konductor|v1\.2\.0|k-developer/i);
  assert.match(text, /\.kiro\/specs\/hold\/requirements\.md/);
  assert.doesNotMatch(text, /See \.kiro\/specs /);
  assert.match(text, /    indented {2}code {3}keeps its spacing/);
  assert.ok(['skills', 'sop', 'maker-checker', 'steering', 'agent-files', 'role-agent', 'kiro-specs-dir'].every((id) => fired[id] >= 1), JSON.stringify(fired));
});

// S5
test('a quote that is not in the bundle downgrades the verdict one level and is flagged', async () => {
  const { root, common } = fixture([{ arm: 'vanilla', finalText: 'Fixed a.txt.', files: { 'a.txt': 'fixed\n' } }]);
  try {
    const verdicts = { c1: 'pass', c2: 'partial' };
    const caller = stub((c) => JSON.stringify({
      criteria: [...c.prompt.matchAll(/^- id: (\S+)/gm)].map((m) => ({ id: m[1], verdict: verdicts[m[1]], evidence: m[1] === 'c1' ? 'a sentence the output never contained' : 'Fixed a.txt.' })),
    }));
    const j = await runJudging({ ...common, caller });
    const [c1, c2] = j.rubric[0].criteria;
    assert.deepEqual([c1.verdict, c1.verdictScored, c1.verdictRaw, c1.evidenceDowngraded, c1.evidenceFound], ['partial', 'partial', 'pass', true, false]);
    assert.deepEqual([c2.verdict, c2.evidenceDowngraded, c2.evidenceFound], ['partial', undefined, true]);
    assert.equal(j.rubric[0].score, (1 * 0.5 + 3 * 0.5) / 4);
    assert.equal(j.rubric[0].scoreRaw, (1 * 1 + 3 * 0.5) / 4);
  } finally { rm(root); }
});

// S6
test('runs with an infra error or no workspace are not judged and are listed apart', async () => {
  const { root, common, runDir } = fixture([
    { arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2, infraError: 'post-processing failed: x', status: 'error' }, { arm: 'vanilla', rep: 3 },
  ]);
  try {
    fs.rmSync(path.join(runDir, 'vanilla/t1/3/workspace'), { recursive: true });
    const caller = stub();
    const j = await runJudging({ ...common, caller });
    assert.equal(j.rubric.length, 1);
    assert.equal(caller.calls.length, 1);
    assert.deepEqual(j.notJudged.map((n) => `${n.replicate}:${n.reason}`).sort(), ['2:infraError', '3:no workspace']);
    const { report } = buildReport({ run: loadRun(runDir), tasks: loadTasks(common.benchDir), baseline: 'vanilla' });
    assert.equal(report.arms.vanilla.overall.notJudged, 2);
    assert.match(renderMarkdown(report), /Not judged \(2\)/);
  } finally { rm(root); }
});

// Judge accounting
test('spend accumulates across invocations, cached calls cost 0 and keep their latency flagged as cached', async () => {
  const { root, common, runDir } = fixture([{ arm: 'vanilla', finalText: 'one' }, { arm: 'v1.2.0', finalText: 'two' }]);
  try {
    const first = await runJudging({ ...common, caller: stub() });
    assert.ok(Math.abs(first.spentCredits - 0.2) < 1e-9);
    const second = await runJudging({ ...common, caller: stub() });
    assert.ok(Math.abs(second.spentCredits - 0.2) < 1e-9, 'a fully cached rerun adds nothing and erases nothing');
    const third = await runJudging({ ...common, judges: ['gpt-test', 'deepseek-test'], caller: stub() });
    assert.ok(Math.abs(third.spentCredits - 0.4) < 1e-9);
    assert.ok(Math.abs(third.spentByJudge['gpt-test'] - 0.2) < 1e-9 && Math.abs(third.spentByJudge['deepseek-test'] - 0.2) < 1e-9);
    assert.deepEqual(third.invocations.map((i) => [i.calls, i.cachedCalls]), [[2, 0], [2, 2], [4, 2]]);
    const cached = third.rubric.find((r) => r.judge === 'gpt-test').calls[0];
    assert.deepEqual([cached.cached, cached.credits, cached.originalCredits, cached.latencyMs], [true, 0, 0.1, 10]);
    const md = renderMarkdown(buildReport({ run: loadRun(runDir), tasks: loadTasks(common.benchDir), baseline: 'vanilla' }).report);
    assert.match(md, /Total judge spend over all invocations: 0\.400/);
    assert.match(md, /\| gpt-test \| 2 \| 0 \| 2 \(2\) \| 0 \| 0\.200 \|/);
  } finally { rm(root); }
});

// N6
test('the shipped suites resolve to the gpt, deepseek and glm panel', () => {
  const tasks = loadTasks(REAL_BENCH);
  for (const name of ['lite', 'full']) {
    const suite = loadSuite(name, tasks, REAL_BENCH);
    const r = resolveJudges({ suiteJudges: suite.judges, subjectModel: 'claude-sonnet-5.5' });
    assert.deepEqual(r.judges, ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'], name);
    assert.equal(r.small, false);
  }
  assert.deepEqual(DEFAULT_JUDGES, ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5']);
});

test('fewer than 3 model families is refused unless --allow-small-panel; --judges overrides the suite', () => {
  const suiteJudges = ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'];
  assert.throws(() => resolveJudges({ cliJudges: 'gpt-5.6-luna,deepseek-3.2', suiteJudges }), /at least 3.*--allow-small-panel/);
  assert.throws(() => resolveJudges({ suiteJudges: ['gpt-5.6-luna'] }), /at least 3/);
  assert.throws(() => resolveJudges({ cliJudges: 'gpt-5.6-luna,gpt-5.6-sol,glm-5' }), /one judge per family/);
  assert.throws(() => resolveJudges({ cliJudges: 'claude-sonnet-4.6,deepseek-3.2,glm-5', allowSmallPanel: true }), /Claude/);
  const small = resolveJudges({ cliJudges: 'gpt-5.6-luna', suiteJudges, allowSmallPanel: true });
  assert.deepEqual(small, { judges: ['gpt-5.6-luna'], small: true });
  assert.deepEqual(resolveJudges({ cliJudges: 'qwen3-coder-next,deepseek-3.2,glm-5', suiteJudges }).judges, ['qwen3-coder-next', 'deepseek-3.2', 'glm-5']);
  assert.deepEqual(resolveJudges({ suiteJudges: [] }).judges, DEFAULT_JUDGES);
});

test('judge CLI refuses a small panel and records the override in judgments.json', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }, { arm: 'k' }]);
    const args = ['judge', '--run', runDir, '--bench-dir', bench, '--judges', 'gpt-test', '--judge-cmd', FAKE];
    const refused = spawnSync('node', [BENCH_JS, ...args], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /at least 3/);
    assert.equal(fs.existsSync(path.join(runDir, 'judgments.json')), false);
    const ok = spawnSync('node', [BENCH_JS, ...args, '--allow-small-panel'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /fewer than 3 model families/);
    const j = JSON.parse(fs.readFileSync(path.join(runDir, 'judgments.json'), 'utf8'));
    assert.deepEqual(j.panel, { families: ['gpt'], small: true });
    const md = renderMarkdown(buildReport({ run: loadRun(runDir), tasks: loadTasks(bench), baseline: 'vanilla' }).report);
    assert.match(md, /judge panel: 1 model family/);
  } finally { rm(root); }
});

// --kiro-bin, raw stream capture, --auth-db
test('judge --kiro-bin runs the given binary, keeps each raw stream and spends its credits', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }]);
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    const finalText = JSON.stringify({ criteria: [{ id: 'c1', verdict: 'pass', evidence: 'a.txt' }, { id: 'c2', verdict: 'pass', evidence: 'a.txt' }] });
    const kiro = makeFakeKiro(path.join(root, 'bin'), { dir: probe, credits: 0.25, finalText });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const tmpdir = path.join(root, 'tmp');
    fs.mkdirSync(tmpdir);
    const r = spawnSync('node', [BENCH_JS, 'judge', '--run', runDir, '--bench-dir', bench, '--judges', 'gpt-test', '--allow-small-panel', '--mode', 'rubric',
      '--kiro-bin', kiro, '--auth-db', authDb, '--isolate', 'none'], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmpdir } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /live spend 0\.250 credits \(all invocations: 0\.250\)/);
    const started = JSON.parse(fs.readFileSync(path.join(probe, 'started.json'), 'utf8'));
    assert.ok(started.args.includes('--trust-tools=') && started.args.includes('gpt-test'));
    const raw = fs.readdirSync(path.join(runDir, 'judge/raw'));
    assert.equal(raw.filter((n) => n.endsWith('.jsonl')).length, 1);
    assert.match(fs.readFileSync(path.join(runDir, 'judge/raw', raw[0]), 'utf8'), /runFinished/);
    assert.deepEqual(fs.readdirSync(tmpdir), [], 'judge scratch and auth copy are gone');
  } finally { rm(root); }
});

// N3
async function interrupt(signal, { useKiro }) {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }]);
    const tmpdir = path.join(root, 'tmp');
    fs.mkdirSync(tmpdir);
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    const pidFile = path.join(root, 'judge.pid');
    const args = [BENCH_JS, 'judge', '--run', runDir, '--bench-dir', bench, '--judges', 'gpt-test', '--allow-small-panel', '--mode', 'rubric'];
    if (useKiro) {
      const kiro = makeFakeKiro(path.join(root, 'bin'), { dir: probe, sleepSec: 60 });
      fs.writeFileSync(path.join(root, 'data.sqlite3'), 'fake-auth');
      args.push('--kiro-bin', kiro, '--auth-db', path.join(root, 'data.sqlite3'), '--isolate', 'none');
    } else {
      args.push('--judge-cmd', FAKE);
    }
    const child = spawn('node', args, { env: { ...process.env, TMPDIR: tmpdir, FAKE_JUDGE_MODE: 'sleep', FAKE_JUDGE_PIDFILE: pidFile }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
    const pid = await waitFor(() => {
      const f = useKiro ? path.join(probe, 'started.json') : pidFile;
      if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8')) return null;
      return useKiro ? JSON.parse(fs.readFileSync(f, 'utf8')).pid : Number(fs.readFileSync(f, 'utf8'));
    });
    if (useKiro) assert.equal(fs.readdirSync(tmpdir).some((n) => n.startsWith('bench-judge-')), true, 'scratch exists while the judge runs');
    child.kill(signal);
    const code = await exited;
    assert.notEqual(code, 0, stderr);
    await waitFor(() => !alive(pid), 5000);
    assert.deepEqual(fs.readdirSync(tmpdir), [], 'no scratch HOME or auth copy is left');
  } finally { rm(root); }
}

for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
  test(`${signal} during the judge phase kills the judge command and leaves nothing behind`, () => interrupt(signal, { useKiro: false }));
}
test('SIGTERM during the judge phase removes the scratch HOME and the auth copy of a kiro judge call', () => interrupt('SIGTERM', { useKiro: true }));
test('SIGHUP during the judge phase removes the scratch HOME and the auth copy of a kiro judge call', () => interrupt('SIGHUP', { useKiro: true }));
