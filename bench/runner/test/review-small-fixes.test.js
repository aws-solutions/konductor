// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small, separate hardening fixes: judge family guard, empty judge evidence, trigger error rows, CRLF frontmatter, the
// orchestrator verdict parser, the credit ledger's unknown count, variant symlink containment, the baseline first write,
// and the scratch path that planning prints.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { modelFamily, checkJudgeModel, checkPanel } = require('../../judge/config.js');
const { frontmatter, fmValue } = require('../lib/frontmatter.js');
const om = require('../lib/orch-metrics.js');
const { openLedger } = require('../lib/credit-ledger.js');
const trig = require('../../cap/trigger.js');
const { buildVariant, variantPaths } = require('../../cap/variant.js');
const { baselineUpdate } = require('../../cap/baseline.js');
const { makeCapRepo } = require('./cap-helpers.js');
const { tmp, write } = require('./helpers.js');

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// ---- judge family ----

test('modelFamily drops a provider prefix, so a prefixed Claude id is still a Claude model', () => {
  for (const id of ['anthropic/claude-sonnet-5', 'openrouter/anthropic/claude-x', 'bedrock/anthropic.claude-3', 'global.anthropic.claude-sonnet-5-5', 'claude-sonnet-5.5']) assert.equal(modelFamily(id), 'claude', id);
  assert.equal(modelFamily('openai/gpt-5.6-sol'), 'gpt');
  assert.equal(modelFamily('gpt-5.6-sol'), 'gpt');
});

test('the no-Claude judge guard cannot be bypassed with a provider prefix', () => {
  for (const id of ['anthropic/claude-x', 'openrouter/anthropic/claude-sonnet-5', 'Anthropic/Claude-x', 'vendor/some-claude-fork']) {
    assert.throws(() => checkJudgeModel(id, 'gpt-5.6-sol'), /is a Claude model/, id);
  }
  assert.throws(() => checkPanel(['anthropic/claude-x', 'claude-y']), /both claude models/);
  assert.doesNotThrow(() => checkJudgeModel('openai/gpt-5.6-sol', 'claude-sonnet-5.5'));
});

// ---- trigger rows ----

const CAP = { id: 'skill:alpha', name: 'alpha', kind: 'skill' };
const result = (o = {}) => ({ status: 'success', replicate: 1, triggerQuery: { queryId: 'q1', expect: 'none' }, capInvocation: { requested: [], delegatedTo: [], identified: [] }, skillsLoaded: [], flags: [], ...o });

test('a run that errored or timed out without reaching the capability is not scored as "did not fire"', () => {
  const r = trig.liveRows([result(), result({ status: 'error' }), result({ status: 'timeout' }), result({ flags: ['modelMismatch'] })], CAP);
  assert.equal(r.rows.length, 1);
  assert.equal(r.dropped.failed, 3);
});

test('a run stopped early on purpose after its first decision is still scored', () => {
  const r = trig.liveRows([result({ status: 'error', flags: ['earlyStopped'] })], CAP);
  assert.equal(r.rows.length, 1);
  assert.equal(r.dropped.failed, 0);
});

test('a run that timed out after the capability fired still counts as a hit', () => {
  const r = trig.liveRows([result({ status: 'timeout', skillsLoaded: [{ name: 'alpha' }] })], CAP);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].hit, true);
  assert.equal(r.dropped.failed, 0);
});

// ---- frontmatter ----

test('frontmatter reads CRLF and BOM files the same as LF', () => {
  const lf = '---\nname: alpha\ndescription: Use when X.\n---\n\nBody\n';
  for (const text of [lf.replace(/\n/g, '\r\n'), `\ufeff${lf}`, `\ufeff${lf.replace(/\n/g, '\r\n')}`]) {
    assert.equal(fmValue(frontmatter(text), 'name'), 'alpha');
    assert.equal(fmValue(frontmatter(text), 'description'), 'Use when X.');
  }
});

test('a CRLF replacement cannot rename a skill past the name check', () => {
  const s = tmp();
  try {
    const r = makeCapRepo(s);
    const file = path.join(s, 'cand.md');
    fs.writeFileSync(file, '---\r\nname: other\r\ndescription: Use when X.\r\n---\r\n');
    assert.throws(() => buildVariant({ repo: r.repo, base: 'v0', replace: [`skill:alpha=${file}`], scratch: path.join(s, 'scratch') }), /must stay "alpha"/);
  } finally { rm(s); }
});

// ---- orchestrator verdict parser ----

const spec = () => om.loadMetricsSpec();
const verdict = (output) => om.verdictOf({ output }, spec());

test('a verdict template or a conflicting pair of verdicts is never read as a pass', () => {
  assert.equal(verdict('Verdict: PASS | FAIL'), 'unknown', 'a pipe is a template');
  assert.equal(verdict('Verdict: PASS or FAIL'), 'unknown', '"or" joins two verdicts');
  assert.equal(verdict('Verdict: PASS / FAIL'), 'unknown');
  assert.equal(verdict('Verdict: <PASS|FAIL>'), 'unknown');
  assert.equal(verdict('Reviewer A\nVerdict: PASS\nReviewer B\nVerdict: FAIL'), 'fail', 'conflicting reviewers read as a fail');
});

test('a plain verdict still reads as before, and the last template line does not hide a real verdict', () => {
  assert.equal(verdict('Verdict: PASS'), 'pass');
  assert.equal(verdict('Verdict: FAIL'), 'fail');
  assert.equal(verdict('Format: Verdict: PASS | FAIL\n\nVerdict: APPROVED'), 'pass');
  assert.equal(verdict('Verdict: PASS\nVerdict: PASS'), 'pass');
  assert.equal(verdict('The verdict is clear. No CRITICAL or IMPORTANT findings.'), 'pass');
});

// ---- ledger ----

test('a judge call with unknown credits counts as unknown and the guard message says so', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir, budget: 1 });
    l.record({ kind: 'judge', credits: null });
    l.record({ kind: 'judge', credits: 1.5 });
    assert.equal(l.totals().unknown, 1);
    assert.match(l.stopReason(), /1 call\(s\) had unknown credits, so the real spend may be higher/);
    assert.match(l.line(), /1 call\(s\) with unknown credits/);
  } finally { rm(dir); }
});

test('the judge records a null-credit call as unknown instead of 0', async () => {
  const { runJudging } = require('../../judge/run.js');
  const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
  const { makeBench, makeRun } = require('./helpers.js');
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', task: 't1', rep: 1, finalText: 'alpha is here' }]);
    const reply = JSON.stringify({ criteria: [{ id: 'c1', verdict: 'pass', evidence: 'alpha is here' }, { id: 'c2', verdict: 'pass', evidence: 'alpha is here' }] });
    const caller = async () => ({ text: reply, credits: null, latencyMs: 1 });
    const ledger = openLedger({ dir: runDir });
    await runJudging({
      runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
      limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {}, caller, ledger,
    });
    assert.equal(ledger.totals().unknown, 1);
  } finally { rm(root); }
});

// ---- variant containment ----

function repoWithSymlink() {
  const root = tmp();
  const outside = path.join(root, 'outside');
  write(path.join(outside, 'SKILL.md'), '---\nname: evil\ndescription: Use when X.\n---\n\noriginal\n');
  const r = makeCapRepo(root, {
    files: (repo) => {
      write(path.join(repo, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: Use when X.\n---\n\nbody\n');
      fs.mkdirSync(path.join(repo, 'skills'), { recursive: true });
      fs.symlinkSync(outside, path.join(repo, 'skills/evil'));
      write(path.join(repo, 'agents/konductor.agent-spec.json'), `${JSON.stringify({ schemaVersion: '1', name: 'konductor', config: { description: 'k', systemPrompt: 'k', model: 'm' }, dependencies: { skills: { skillNames: ['alpha', 'evil'] }, agentSops: { agentSopNames: [] }, context: { contextNames: [] } }, clientConfig: { kiroCli: {}, claudeCli: { skills: ['alpha', 'evil'] } } }, null, 2)}\n`);
    },
  });
  return { root, outside, repo: r.repo };
}

test('--replace does not write through a symlinked skill directory in the base ref', () => {
  const s = repoWithSymlink();
  try {
    const cand = path.join(s.root, 'cand.md');
    fs.writeFileSync(cand, '---\nname: evil\ndescription: Use when X.\n---\n\nreplaced\n');
    assert.throws(() => buildVariant({ repo: s.repo, base: 'v0', replace: [`skill:evil=${cand}`], scratch: path.join(s.root, 'scratch') }), /symlink|outside/);
    assert.match(fs.readFileSync(path.join(s.outside, 'SKILL.md'), 'utf8'), /original/);
  } finally { rm(s.root); }
});

test('--overlay does not write reference files through a symlinked skill directory', () => {
  const s = repoWithSymlink();
  try {
    const ov = path.join(s.root, 'overlay');
    write(path.join(ov, 'SKILL.md'), '---\nname: evil\ndescription: Use when X.\n---\n\noverlaid\n');
    write(path.join(ov, 'references/extra.md'), 'extra\n');
    assert.throws(() => buildVariant({ repo: s.repo, base: 'v0', overlay: [`skill:evil=${ov}`], scratch: path.join(s.root, 'scratch') }), /symlink|outside/);
    assert.equal(fs.existsSync(path.join(s.outside, 'references')), false);
    assert.match(fs.readFileSync(path.join(s.outside, 'SKILL.md'), 'utf8'), /original/);
  } finally { rm(s.root); }
});

test('an ordinary replace still works', () => {
  const s = tmp();
  try {
    const r = makeCapRepo(s);
    const cand = path.join(s, 'cand.md');
    fs.writeFileSync(cand, '---\nname: alpha\ndescription: Use when X.\n---\n\nnew\n');
    const v = buildVariant({ repo: r.repo, base: 'v0', replace: [`skill:alpha=${cand}`], scratch: path.join(s, 'scratch') });
    assert.match(fs.readFileSync(path.join(v.dir, 'skills/alpha/SKILL.md'), 'utf8'), /new/);
  } finally { rm(s); }
});

// ---- the scratch path in a plan ----

test('the variant path planning prints is the real path the build uses, even under a symlinked directory', () => {
  const s = tmp();
  try {
    const r = makeCapRepo(s);
    const real = path.join(s, 'real');
    fs.mkdirSync(real);
    const link = path.join(s, 'link');
    fs.symlinkSync(real, link);
    const scratch = path.join(link, 'new', 'scratch');
    const planned = variantPaths({ repo: r.repo, base: 'v0', drop: ['skill:alpha'], scratch });
    const built = buildVariant({ repo: r.repo, base: 'v0', drop: ['skill:alpha'], scratch });
    assert.equal(planned.dir, built.dir);
    assert.ok(planned.dir.startsWith(fs.realpathSync(real)), planned.dir);
  } finally { rm(s); }
});

// ---- baseline ----

test('creating the baseline from nothing waives every current finding, so it needs --force', () => {
  const s = tmp();
  try {
    const bench = path.join(s, 'bench');
    fs.mkdirSync(path.join(bench, 'capabilities'), { recursive: true });
    const report = { findings: [{ fid: 'lint-name-dir|skill:x', rule: 'lint-name-dir', id: 'skill:x' }], base: { ref: 'v0', commitSha: null } };
    const refused = baselineUpdate({ report, benchDir: bench });
    assert.equal(refused.written, false);
    assert.deepEqual(refused.added, ['lint-name-dir|skill:x']);
    assert.equal(fs.existsSync(path.join(bench, 'capabilities', 'audit-baseline.json')), false);
    assert.equal(baselineUpdate({ report, benchDir: bench, force: true }).written, true);
    assert.equal(baselineUpdate({ report: { ...report, findings: [] }, benchDir: bench }).written, true, 'shrinking still needs no force');
  } finally { rm(s); }
});
