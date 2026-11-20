#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The one free dry run of the scenario pack (no model call). For one task it scores, with the bench's own check code:
//   reference  the fixture plus solutions/<id>/, repeated (default 3 times) to prove the checks are deterministic;
//   stub       the untouched fixture (an agent that changed nothing), repeated the same way;
//   lazy, alt  a shallow answer and a second correct answer, when the batch has them (answers/<id>/{lazy,alt} by
//              default; `bench/scenarios/lib/answers.js` writes mechanical ones), scored once each;
//   variants   any other answers the batch config names (for example T2's dump review), scored once each.
// It also checks that every `tests` check runs under a per-test timeout, that the task file loads in the runner, and,
// when the batch asks for it, that a hung hidden test fails alone (the canary). The gates are the plan's (4.6):
// reference >= 95, stub <= 20, lazy <= 40, alt >= 80, deterministic; a batch config may add or replace gates.
//
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/tN/scenario.config.js [id ...] [--repeat N] [--json] [--record]
//
// No ids: every task of the batch. --record writes pilot.dryRun (reference, stub, lazy, alt, date) into each task file
// that has all four scores. Scratch goes under $TMPDIR and is removed. Exit 1 when a task fails a gate.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck, withPerTestTimeout } = require('../../runner/lib/check-matcher.js');
const { resolvePython, linkPython, wantedVersion } = require('../../runner/lib/python-pin.js');
const { validate, loadSchema } = require('../../runner/lib/schema.js');
const { v3Errors } = require('../../runner/lib/task-v3.js');
const { codeScore, round1 } = require('./score.js');
const { makeWorkspace } = require('./workspace.js');
const { loadConfig } = require('./config.js');

const BENCH = path.join(__dirname, '..', '..');
const CANARY_NODE = "const { test } = require('node:test');\ntest('canary: a hung test', () => new Promise(() => {}));\n";
const CANARY_PY = "import time\nfrom timeouts import TimedCase\n\n\nclass Canary(TimedCase):\n    def test_canary_hang(self):\n        time.sleep(600)\n";

const signature = (results) => JSON.stringify(results.map((r) => [r.type, r.passed, r.tests ? [r.tests.passed, r.tests.total] : null]));

function runChecks(task, ws, ctx) {
  return task.checks.map((c, i) => {
    let r;
    try {
      r = evalCheck(ws, c, { pristineDir: ctx.fixtureDir, hiddenDir: ctx.hiddenDir, env: ctx.env, scratchDir: ctx.scratchDir });
    } catch (e) {
      r = { passed: false, detail: e.message };
    }
    return { i, type: c.type, kind: c.kind, weight: c.weight, passed: r.passed, detail: r.detail, ...(r.tests ? { tests: r.tests } : {}) };
  });
}

// Adds a test that never finishes to a copy of the hidden dir; the suite must still finish, with only that test failed.
function canary(task, ws, ctx, baseline, where) {
  const hid = path.join(ctx.root, 'hidden-canary');
  fs.cpSync(ctx.hiddenDir, hid, { recursive: true });
  const py = fs.existsSync(path.join(hid, path.dirname(where.python)));
  fs.mkdirSync(path.dirname(path.join(hid, py ? where.python : where.node)), { recursive: true });
  fs.writeFileSync(path.join(hid, py ? where.python : where.node), py ? CANARY_PY : CANARY_NODE);
  const check = task.checks.find((c) => c.type === 'tests');
  const t0 = Date.now();
  const r = evalCheck(ws, check, { hiddenDir: hid, env: ctx.env, scratchDir: ctx.scratchDir });
  fs.rmSync(hid, { recursive: true, force: true });
  const ok = Boolean(r.tests && r.tests.passed === baseline.passed && r.tests.total === baseline.total + 1);
  return { ok, seconds: (Date.now() - t0) / 1000, detail: r.detail };
}

function environment(root, cfg) {
  const env = { ...process.env, TMPDIR: path.join(root, 'tmp') };
  delete env.NODE_TEST_CONTEXT;
  Object.assign(env, cfg.env || {});
  fs.mkdirSync(env.TMPDIR);
  if (cfg.python !== false) {
    // Python 3.12 first on PATH, as the bench pins it for a run whose checks name python.
    const py = resolvePython({ env, want: wantedVersion(BENCH) });
    if (py.executable) env.PATH = [linkPython(root, py.executable, py.version), env.PATH].join(path.delimiter);
  }
  return env;
}

function withConversation(env, root, conv, name) {
  const out = { ...env };
  delete out.BENCH_CONVERSATION;
  if (conv) {
    const f = path.join(root, `conv-${name}.json`);
    fs.writeFileSync(f, JSON.stringify(conv));
    out.BENCH_CONVERSATION = f;
  }
  return out;
}

/** The default gates of a dry-run result (plan 4.6). */
function defaultGates(out) {
  const s = out.scores;
  return {
    loads: out.loadErrors.length === 0,
    timeouts: out.timeouts,
    reference: s.reference !== null && s.reference >= 95,
    stub: s.stub === undefined || (s.stub !== null && s.stub <= 20),
    deterministic: out.deterministic,
    ...(s.lazy !== undefined ? { lazy: s.lazy !== null && s.lazy <= 40 } : {}),
    ...(s.alt !== undefined ? { alt: s.alt !== null && s.alt >= 80 } : {}),
    ...(out.canary ? { canary: out.canary.ok } : {}),
    ...(out.errors.length ? { task: false } : {}),
  };
}

/** Dry run of task `id` of the batch `cfg` (a loaded config, see config.js). */
function dryRun(id, cfg, { repeat = 3 } = {}) {
  const task = cfg.readTask(id);
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `dry-${id}-`));
  try {
    const ctx = { root, fixtureDir: cfg.fixtureDir(task), hiddenDir: cfg.hiddenDir(task), scratchDir: path.join(root, 'scratch') };
    const env = environment(root, cfg);
    const out = {
      id, repeat, scores: {}, modes: {}, deterministic: true, canary: null,
      loadErrors: [...validate(loadSchema('task'), task), ...v3Errors(task)].map(String),
      timeouts: task.checks.filter((c) => c.type === 'tests').every((c) => /--test-timeout=\d+/.test(withPerTestTimeout(c.cmd))),
      errors: cfg.taskErrors ? cfg.taskErrors(task) : [],
    };
    for (const m of cfg.modes(task)) {
      ctx.env = withConversation(env, root, m.conversation, m.name);
      const runs = [];
      for (let i = 0; i < (m.repeat ? repeat : 1); i++) {
        const ws = makeWorkspace(path.join(root, `ws-${m.name}`), ctx.fixtureDir, m.overlay);
        runs.push(runChecks(task, ws, ctx));
        if (i === 0 && m.name === 'reference' && cfg.canary && runs[0].some((r) => r.type === 'tests' && r.tests)) {
          out.canary = canary(task, ws, ctx, runs[0].find((r) => r.type === 'tests').tests, cfg.canary);
        }
      }
      if (new Set(runs.map(signature)).size > 1) out.deterministic = false;
      const sc = codeScore(runs[0]);
      out.scores[m.name] = sc.score === null ? null : round1(sc.score);
      out.modes[m.name] = { ...sc, results: runs[0] };
    }
    out.gates = cfg.gates ? cfg.gates(out, defaultGates(out)) : defaultGates(out);
    out.pass = Object.values(out.gates).every(Boolean);
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** pilot with dryRun set from a result; null when the result lacks one of the four scores. Decision keep needs every gate. */
function pilotWith(pilot, res, date) {
  const s = res.scores;
  if (![s.reference, s.stub, s.lazy, s.alt].every((v) => typeof v === 'number')) return null;
  const dryRun = { reference: s.reference, stub: s.stub, lazy: s.lazy, alt: s.alt, date };
  return { scores: {}, ...(pilot || {}), reference: s.reference, stub: s.stub, dryRun, decision: res.pass ? 'keep' : 'fix', date };
}

/** Writes pilot.dryRun into the task file; returns the new pilot or null when the result is incomplete. */
function record(cfg, res, date = new Date().toISOString().slice(0, 10)) {
  const file = cfg.taskFile(res.id);
  const task = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pilot = pilotWith(task.pilot, res, date);
  if (!pilot) return null;
  task.pilot = pilot;
  fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
  return pilot;
}

/** One line per task: the scores and the failed gates. */
function line(res) {
  const failed = Object.entries(res.gates).filter(([, v]) => !v).map(([k]) => k);
  const scores = Object.entries(res.scores).map(([k, v]) => `${k} ${v === null ? 'n/a' : v}`).join(', ');
  const notes = [...res.loadErrors.slice(0, 2), ...res.errors].join('; ');
  return `${res.pass ? 'ok  ' : 'FAIL'} ${res.id}: ${scores}${failed.length ? ` (fails: ${failed.join(', ')})` : ''}${notes ? ` [${notes}]` : ''}`;
}

function main(argv) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const cfgFile = at('--config');
  if (!cfgFile) { console.error('usage: dry-run.js --config FILE [id ...] [--repeat N] [--json] [--record]'); return 2; }
  const cfg = loadConfig(path.resolve(cfgFile));
  const repeat = at('--repeat') ? Number(at('--repeat')) : 3;
  const ids = argv.filter((a, i) => !a.startsWith('--') && !['--config', '--repeat'].includes(argv[i - 1]));
  const rows = [];
  for (const id of ids.length ? ids : cfg.ids()) {
    const res = dryRun(id, cfg, { repeat });
    if (argv.includes('--record')) res.recorded = record(cfg, res);
    rows.push(res);
    if (!argv.includes('--json')) console.log(line(res));
  }
  if (argv.includes('--json')) console.log(JSON.stringify(rows.map(({ modes, ...r }) => ({ ...r, failing: Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, m.results.filter((x) => !x.passed).map((x) => `#${x.i} ${x.type}: ${x.detail}`)])) })), null, 2));
  return rows.every((r) => r.pass) ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { dryRun, defaultGates, pilotWith, record, line, runChecks, main };
