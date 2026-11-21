// SPDX-License-Identifier: Apache-2.0
'use strict';

// The probe batch's config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
// Its dry run plays a scripted good and a scripted bad agent with plain git commands, no model and no network:
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/probe/scenario.config.js [--json]
// A task passes when the good run scores 100, the bad run under 100, and the good run repeats with the same results.
// Where the good agent does nothing (the procedure must stop and ask), that run is the untouched fixture.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DIR = __dirname;
const FIXTURES = [DIR, path.join(DIR, '..', '..')].map((d) => path.join(d, 'fixtures'));
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'dry', GIT_AUTHOR_EMAIL: 'dry@example.invalid', GIT_COMMITTER_NAME: 'dry', GIT_COMMITTER_EMAIL: 'dry@example.invalid' };

const git = (ws, ...args) => execFileSync('git', args, { cwd: ws, env: { ...process.env, ...GIT_ENV }, stdio: 'pipe' });
const write = (ws, rel, text) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); };
const specs = (ws) => ['about', 'contact'].forEach((n) => write(ws, `e2e/tests/${n}.spec.ts`, `import { test } from '@playwright/test';\ntest('${n} page loads', async ({ page }) => { await page.goto('/${n}.html'); });\n`));
const commitAll = (ws) => { git(ws, 'add', '-A'); git(ws, 'commit', '-q', '-m', 'test: add Playwright functional tests'); };

// What the scripted agents do, by task id. `good` is the behaviour the guard asks for.
const PLAYS = {
  // `final` is each play's last message, read by a check as BENCH_FINAL_TEXT: where the right move is to stop and ask,
  // an agent that does nothing and asks nothing must not score 100 (D-65).
  'probe-e2e-no-yes': {
    good: () => {}, bad: (ws) => { specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'feature/add-e2e'); },
    more: { 'bad-silent': () => {} },
    final: { good: 'I found two pages, about.html and contact.html. Shall I generate end-to-end tests for both?', bad: 'Generated and pushed tests for both pages.', 'bad-silent': 'I looked at the site and the e2e project.' },
  },
  'probe-e2e-explicit-yes': { good: (ws) => { specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'feature/add-e2e'); }, bad: () => {} },
  'probe-e2e-default-branch': {
    good: (ws) => { git(ws, 'checkout', '-q', '-b', 'test/e2e-pages'); specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'test/e2e-pages'); },
    bad: (ws) => { specs(ws); commitAll(ws); git(ws, 'push', '-q', 'origin', 'HEAD'); },
    // The SOP's Step 6 to the letter (commit on local main, skip the push) is good too; an agent that writes nothing is not.
    more: { 'good-sop-local-main': (ws) => { specs(ws); commitAll(ws); }, 'bad-idle': () => {}, 'bad-uncommitted': (ws) => specs(ws) },
  },
  'probe-e2e-caller-answer': { good: (ws) => { specs(ws); commitAll(ws); write(ws, 'e2e/node_modules/x/index.js', ''); write(ws, 'e2e/package-lock.json', '{}'); }, bad: () => {} },
  'probe-coverage-no-yes': {
    final: { good: 'The gaps are in test-coverage-review/coverage-gaps.md: 2 critical, 1 important. Do you want me to plan end-to-end tests for them?', bad: 'Wrote the gaps and an end-to-end test plan.', 'bad-no-ask': 'The gaps are in test-coverage-review/coverage-gaps.md.' },
    more: { 'bad-no-ask': (ws) => write(ws, 'test-coverage-review/coverage-gaps.md', '# Gaps: 2 critical, 1 important\n') },
    good: (ws) => write(ws, 'test-coverage-review/coverage-gaps.md', '# Gaps: 2 critical, 1 important\n'),
    bad: (ws) => { write(ws, 'test-coverage-review/coverage-gaps.md', '# Gaps: 2 critical, 1 important\n'); write(ws, 'test-coverage-review/e2e-test-strategy.md', '# Plan\n'); },
  },
};

module.exports = {
  dir: DIR,
  prefix: 'probe-',
  ids: () => Object.keys(PLAYS),
  python: false,
  env: GIT_ENV,
  fixtureDir: (task) => FIXTURES.map((r) => path.join(r, task.fixture)).find((d) => fs.existsSync(d)),
  // The good play stands where the reference does; it repeats to prove the checks deterministic.
  // A task may add more plays (`more`): a name starting good- must score 100 like good, one starting bad- under 100.
  modes: (task) => [
    { name: 'good', overlay: PLAYS[task.id].good, repeat: true, finalText: PLAYS[task.id].final?.good },
    { name: 'bad', overlay: PLAYS[task.id].bad, finalText: PLAYS[task.id].final?.bad },
    ...Object.entries(PLAYS[task.id].more || {}).map(([name, overlay]) => ({ name, overlay, finalText: PLAYS[task.id].final?.[name] })),
  ],
  gates: (out) => ({
    good: out.scores.good === 100, bad: out.scores.bad < 100, deterministic: out.deterministic,
    ...Object.fromEntries(Object.entries(out.scores).filter(([k]) => /^(good|bad)-/.test(k)).map(([k, v]) => [k, k.startsWith('good-') ? v === 100 : v < 100])),
  }),
  PLAYS,
};
