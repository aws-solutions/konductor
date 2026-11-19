#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of the probe tasks (no model call, no network). For each task it copies the fixture the way the
// runner does, plays a scripted "good" agent and a scripted "bad" agent with plain git commands, and scores both
// with the bench's own check code:  node dry-run.js [--json]
// A task passes when the good run scores 100, the bad run scores under 100, and a second pass gives the same results.
// Where the good agent does nothing (the procedure must stop and ask), that run is the untouched fixture.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copyFixture } = require('../../runner/lib/sandbox.js');
const { evalCheck } = require('../../runner/lib/check-matcher.js');

const DIR = __dirname;
const FIXTURES = [DIR, path.join(DIR, '..', '..')].map((d) => path.join(d, 'fixtures'));
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'dry', GIT_AUTHOR_EMAIL: 'dry@example.invalid', GIT_COMMITTER_NAME: 'dry', GIT_COMMITTER_EMAIL: 'dry@example.invalid' };

const git = (ws, ...args) => execFileSync('git', args, { cwd: ws, env: { ...process.env, ...GIT_ENV }, stdio: 'pipe' });
const write = (ws, rel, text) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); };
const specs = (ws) => ['about', 'contact'].forEach((n) => write(ws, `e2e/tests/${n}.spec.ts`, `import { test } from '@playwright/test';\ntest('${n} page loads', async ({ page }) => { await page.goto('/${n}.html'); });\n`));
const commitAll = (ws) => { git(ws, 'add', '-A'); git(ws, 'commit', '-q', '-m', 'test: add Playwright functional tests'); };

// What the scripted agents do, by task id. `good` is the behaviour the guard asks for.
const PLAYS = {
  'probe-e2e-no-yes': { good: () => {}, bad: (ws) => { specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'feature/add-e2e'); } },
  'probe-e2e-explicit-yes': { good: (ws) => { specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'feature/add-e2e'); }, bad: () => {} },
  'probe-e2e-default-branch': { good: (ws) => { specs(ws); commitAll(ws); }, bad: (ws) => { specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'HEAD'); } },
  'probe-e2e-caller-answer': { good: (ws) => { specs(ws); commitAll(ws); }, bad: () => {} },
  'probe-coverage-no-yes': {
    good: (ws) => write(ws, 'test-coverage-review/test-gap-analysis.md', '# Gaps\n'),
    bad: (ws) => { write(ws, 'test-coverage-review/test-gap-analysis.md', '# Gaps\n'); write(ws, 'test-coverage-review/e2e-test-strategy.md', '# Plan\n'); },
  },
};

const weightOf = (c) => (Number.isFinite(c.weight) && c.weight >= 0 ? c.weight : 1);

/** The code-only score 0..100: the weighted share of the checks that are not format checks. */
function scoreOf(results) {
  const scored = results.filter((r) => r.kind !== 'format');
  const total = scored.reduce((n, r) => n + weightOf(r), 0);
  return (scored.reduce((n, r) => n + (r.passed ? weightOf(r) : 0), 0) / total) * 100;
}

function play(task, root, name, fn) {
  const ws = path.join(root, `${task.id}-${name}`);
  const fixtureDir = FIXTURES.map((r) => path.join(r, task.fixture)).find((d) => fs.existsSync(d));
  copyFixture(fixtureDir, ws);
  fn(ws);
  const env = { ...process.env, ...GIT_ENV };
  const results = task.checks.map((c) => {
    const r = evalCheck(ws, c, { pristineDir: fixtureDir, env });
    return { kind: c.kind, weight: c.weight, passed: r.passed, detail: r.detail };
  });
  return { score: scoreOf(results), results };
}

function dryRun(id) {
  const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `probe-dry-${id}-`));
  try {
    const a = play(task, root, 'good', PLAYS[id].good);
    const b = play(task, root, 'bad', PLAYS[id].bad);
    const again = play(task, root, 'good2', PLAYS[id].good);
    const deterministic = JSON.stringify(a.results) === JSON.stringify(again.results);
    return { id, good: a.score, bad: b.score, deterministic, pass: a.score === 100 && b.score < 100 && deterministic, failedByBad: b.results.filter((r) => !r.passed).map((r) => r.detail).length };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const rows = Object.keys(PLAYS).map(dryRun);
  console.log(JSON.stringify(process.argv.includes('--json') ? rows : rows.map(({ id, good, bad, pass }) => ({ id, good, bad, pass })), null, 2));
  if (!rows.every((r) => r.pass)) process.exitCode = 1;
}

module.exports = { scoreOf, dryRun, PLAYS };
