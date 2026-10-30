// SPDX-License-Identifier: Apache-2.0
'use strict';

// Portable skill lint checks, the shrink-only ratchet baseline and the capability class. The checks are our own
// implementation of the check names; fixtures here are small hand-built skill trees.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch, git } = require('./cap-helpers.js');
const { lintSkills } = require('../../cap/lint.js');
const { runAudit } = require('../../cap/audit.js');
const { readBaseline, baselineUpdate, BASELINE_FILE } = require('../../cap/baseline.js');
const { planCap } = require('../../cap/plan.js');
const { loadRegistry } = require('../../cap/registry.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

const skill = (root, dir, { name = dir, desc = 'Reviews services for input problems. Use when reviewing a service before release.', fm = '', body = '# Title\n\nSteps.\n', files = {} } = {}) => {
  write(path.join(root, 'skills', dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n${fm}---\n\n${body}`);
  for (const [f, text] of Object.entries(files)) write(path.join(root, 'skills', dir, f), text);
};
const rules = (findings) => findings.map((f) => `${f.rule}|${f.id}${f.detail ? `|${f.detail}` : ''}`).sort();
const lint = (root) => lintSkills({ baseDir: root });

function tree() {
  const root = tmp();
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a clean skill has no findings', () => {
  const t = tree();
  try {
    skill(t.root, 'clean', { fm: 'tags: [review]\nversion: 1.0.0\n' });
    assert.deepEqual(lint(t.root), []);
  } finally { t.done(); }
});

test('the name must equal its directory, be kebab-case and be at most 64 characters', () => {
  const t = tree();
  try {
    skill(t.root, 'dir-a', { name: 'other-name' });
    skill(t.root, 'Snake_Case');
    skill(t.root, 'x'.repeat(65));
    const f = rules(lint(t.root));
    assert.ok(f.includes('lint-name-dir|skill:dir-a'), f.join());
    assert.ok(f.includes('lint-name-kebab|skill:Snake_Case'));
    assert.ok(f.includes(`lint-name-length|skill:${'x'.repeat(65)}`));
  } finally { t.done(); }
});

test('a description in the first or second person is flagged; "Use when you ..." is not', () => {
  const t = tree();
  try {
    skill(t.root, 'me', { desc: 'I review services for you. Use when reviewing.' });
    skill(t.root, 'you', { desc: 'You can use this to plan sprints. Use when planning.' });
    skill(t.root, 'ok', { desc: 'Plans sprints. Use when you need a plan for the next sprint.' });
    const f = rules(lint(t.root));
    assert.ok(f.includes('lint-desc-person|skill:me'));
    assert.ok(f.includes('lint-desc-person|skill:you'));
    assert.ok(!f.some((x) => x.endsWith('skill:ok')));
  } finally { t.done(); }
});

test('SKILL.md over 500 lines is flagged', () => {
  const t = tree();
  try {
    skill(t.root, 'long', { body: `${'line\n'.repeat(520)}` });
    skill(t.root, 'short', { body: `${'line\n'.repeat(400)}` });
    assert.deepEqual(rules(lint(t.root)), ['lint-skill-lines|skill:long']);
  } finally { t.done(); }
});

test('links to files that do not exist are flagged; web links, anchors and existing files are not', () => {
  const t = tree();
  try {
    skill(t.root, 'links', {
      body: '# T\n\nSee [a](references/a.md), [b](references/missing.md#top), [web](https://example.invalid/x), [anchor](#section), [mail](mailto:a@b.invalid).\n',
      files: { 'references/a.md': '# A\n' },
    });
    assert.deepEqual(rules(lint(t.root)), ['lint-link-broken|skill:links|references/missing.md']);
  } finally { t.done(); }
});

test('a file in the skill that SKILL.md never mentions is an orphan; a path mention counts as a reference', () => {
  const t = tree();
  try {
    skill(t.root, 'orph', {
      body: '# T\n\nRead references/used.md first.\n',
      files: { 'references/used.md': '# Used\n', 'references/unused.md': '# Unused\n', 'scripts/run.sh': 'echo hi\n' },
    });
    assert.deepEqual(rules(lint(t.root)), ['lint-orphan-file|skill:orph|references/unused.md', 'lint-orphan-file|skill:orph|scripts/run.sh']);
  } finally { t.done(); }
});

test('a reference file that links on to a second file is flagged as too deep, and that file is not an orphan', () => {
  const t = tree();
  try {
    skill(t.root, 'deep', {
      body: '# T\n\nSee [a](references/a.md).\n',
      files: { 'references/a.md': '# A\n\nMore in [b](b.md).\n', 'references/b.md': '# B\n' },
    });
    assert.deepEqual(rules(lint(t.root)), ['lint-ref-depth|skill:deep|references/b.md']);
  } finally { t.done(); }
});

test('only the known frontmatter keys are allowed', () => {
  const t = tree();
  try {
    skill(t.root, 'keys', { fm: 'license: MIT\nallowed-tools: Read\nmetadata: x\nversion: 1\ntags: [a]\nauthor: me\nhooks: x\n' });
    assert.deepEqual(rules(lint(t.root)), ['lint-frontmatter-key|skill:keys|author', 'lint-frontmatter-key|skill:keys|hooks']);
  } finally { t.done(); }
});

test('a When to Use section that repeats the description is flagged; one that adds detail is not', () => {
  const t = tree();
  try {
    const desc = 'Reviews services for input problems. Use when reviewing a service before release.';
    skill(t.root, 'redundant', { desc, body: '# T\n\n## When to Use\n\nUse when reviewing a service before release for input problems.\n\n## Steps\n\nDo it.\n' });
    skill(t.root, 'useful', { desc, body: '# T\n\n## When to Use\n\n- the diff touches a payment path\n- the change adds a new endpoint\n- an incident follow-up asks for a threat check of the gateway\n\n## Steps\n\nDo it.\n' });
    assert.deepEqual(rules(lint(t.root)), ['lint-redundant-when|skill:redundant']);
  } finally { t.done(); }
});

test('a block of eight lines that appears in two skills is reported once per pair; short or tiny windows are not', () => {
  const t = tree();
  try {
    const block = Array.from({ length: 8 }, (_, i) => `Shared rule number ${i} says to check the input before it reaches the handler.`).join('\n');
    skill(t.root, 'aaa', { body: `# A\n\nOwn intro.\n\n${block}\n\nOwn outro.\n` });
    skill(t.root, 'bbb', { body: `# B\n\n${block}\n\nDifferent ending.\n` });
    skill(t.root, 'ccc', { body: `# C\n\n${block.split('\n').slice(0, 5).join('\n')}\n\nOther.\n` });
    skill(t.root, 'ddd', { body: `# D\n\n${Array.from({ length: 8 }, () => '- ok').join('\n')}\n` });
    skill(t.root, 'eee', { body: `# E\n\n${Array.from({ length: 8 }, () => '- ok').join('\n')}\n` });
    assert.deepEqual(rules(lint(t.root)), ['lint-dup-block|skill:aaa|skill:bbb']);
  } finally { t.done(); }
});

// ---- the ratchet ----

function auditSetup(files) {
  const root = scratch();
  const r = makeCapRepo(root, { files, tag: 'v0' });
  const bench = makeCapBench(root);
  const audit = (o = {}) => runAudit({ repo: r.repo, base: 'v0', harness: 'kiro-cli', benchDir: bench, ...o });
  const baselineFile = path.join(bench, 'capabilities', BASELINE_FILE);
  return { root, repo: r.repo, bench, audit, baselineFile, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const withLintFindings = (repo) => {
  skill(repo, 'good-one');
  skill(repo, 'bad-name', { name: 'other-name' });
  skill(repo, 'orphaned', { files: { 'notes.md': 'x\n' } });
};

const ratchetRules = (rep) => rep.findings.filter((f) => f.rule.startsWith('lint-')).map((f) => `${f.level}|${f.rule}|${f.id}${f.detail ? `|${f.detail}` : ''}`).sort();

test('without a baseline file the lint findings are warnings and the audit passes', () => {
  const s = auditSetup(withLintFindings);
  try {
    const { report, exitCode } = s.audit();
    assert.equal(exitCode, 0);
    assert.deepEqual(ratchetRules(report), ['warn|lint-name-dir|skill:bad-name', 'warn|lint-orphan-file|skill:orphaned|notes.md']);
    assert.equal(report.summary.ratchet, null);
  } finally { s.done(); }
});

test('update-baseline writes every current finding once, and the next audit passes with them waived', () => {
  const s = auditSetup(withLintFindings);
  try {
    const first = s.audit();
    assert.equal(fs.existsSync(s.baselineFile), false, 'the audit itself never writes the baseline');
    const upd = baselineUpdate({ report: first.report, benchDir: s.bench });
    assert.equal(upd.written, true);
    const file = JSON.parse(fs.readFileSync(s.baselineFile, 'utf8'));
    assert.equal(file.schemaVersion, 1);
    assert.ok(Object.keys(file.waived).includes('lint-name-dir|skill:bad-name'));
    const second = s.audit();
    assert.equal(second.exitCode, 0);
    assert.deepEqual(second.report.summary.ratchet, { waived: Object.keys(file.waived).length, new: 0, stale: 0 });
    assert.ok(second.report.findings.filter((f) => f.rule.startsWith('lint-')).every((f) => f.waived === true && f.level === 'warn'));
  } finally { s.done(); }
});

test('a finding that is not in the baseline fails the audit', () => {
  const s = auditSetup(withLintFindings);
  try {
    baselineUpdate({ report: s.audit().report, benchDir: s.bench });
    skill(s.repo, 'newly-bad', { name: 'wrong' });
    git(s.repo, 'add', '.');
    git(s.repo, 'commit', '-q', '-m', 'two');
    git(s.repo, 'tag', 'v1');
    const { report, exitCode } = s.audit({ base: 'v1' });
    assert.equal(exitCode, 1);
    const bad = report.findings.filter((f) => f.level === 'error');
    assert.deepEqual(bad.map((f) => `${f.rule}|${f.id}|${f.ratchet}`), ['lint-name-dir|skill:newly-bad|new']);
    assert.match(bad[0].msg, /new, not in the baseline/);
    assert.equal(report.summary.ratchet.new, 1);
  } finally { s.done(); }
});

test('a waiver that no longer matches a finding fails the audit until it is removed', () => {
  const s = auditSetup(withLintFindings);
  try {
    baselineUpdate({ report: s.audit().report, benchDir: s.bench });
    const file = JSON.parse(fs.readFileSync(s.baselineFile, 'utf8'));
    file.waived['lint-link-broken|skill:good-one|references/gone.md'] = { rule: 'lint-link-broken', id: 'skill:good-one' };
    fs.writeFileSync(s.baselineFile, JSON.stringify(file));
    const { report, exitCode } = s.audit();
    assert.equal(exitCode, 1);
    const stale = report.findings.filter((f) => f.rule === 'ratchet-stale');
    assert.equal(stale.length, 1);
    assert.match(stale[0].msg, /waiver "lint-link-broken\|skill:good-one\|references\/gone\.md" now passes; remove it/);
    assert.equal(report.summary.ratchet.stale, 1);
  } finally { s.done(); }
});

test('update-baseline only shrinks an existing baseline: it drops stale waivers and refuses to add new ones without --force', () => {
  const s = auditSetup(withLintFindings);
  try {
    baselineUpdate({ report: s.audit().report, benchDir: s.bench });
    const file = JSON.parse(fs.readFileSync(s.baselineFile, 'utf8'));
    file.waived['lint-link-broken|skill:good-one|references/gone.md'] = { rule: 'lint-link-broken', id: 'skill:good-one' };
    fs.writeFileSync(s.baselineFile, JSON.stringify(file));
    const shrunk = baselineUpdate({ report: s.audit().report, benchDir: s.bench });
    assert.equal(shrunk.written, true);
    assert.deepEqual(shrunk.removed, ['lint-link-broken|skill:good-one|references/gone.md']);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(s.baselineFile, 'utf8')).waived).includes('lint-link-broken|skill:good-one|references/gone.md'), false);
    const before = fs.readFileSync(s.baselineFile, 'utf8');
    const grown = { ...s.audit().report, findings: [...s.audit().report.findings, { level: 'warn', rule: 'lint-name-dir', id: 'skill:extra', fid: 'lint-name-dir|skill:extra', msg: 'm' }] };
    const refused = baselineUpdate({ report: grown, benchDir: s.bench });
    assert.equal(refused.written, false);
    assert.deepEqual(refused.added, ['lint-name-dir|skill:extra']);
    assert.equal(fs.readFileSync(s.baselineFile, 'utf8'), before);
    assert.equal(baselineUpdate({ report: grown, benchDir: s.bench, force: true }).written, true);
    assert.ok(Object.keys(readBaseline(s.bench).waived).includes('lint-name-dir|skill:extra'));
  } finally { s.done(); }
});

test('a damaged baseline file is an error, not a silent pass', () => {
  const s = auditSetup(withLintFindings);
  try {
    fs.writeFileSync(s.baselineFile, '{ nope');
    assert.throws(() => s.audit(), /audit-baseline\.json is not valid JSON/);
    fs.writeFileSync(s.baselineFile, JSON.stringify({ schemaVersion: 2, waived: {} }));
    assert.throws(() => s.audit(), /schemaVersion 1/);
  } finally { s.done(); }
});

test('cap audit --update-baseline writes the file and says so; without the flag it never does', () => {
  const s = auditSetup(withLintFindings);
  try {
    const env = { PATH: process.env.PATH, HOME: path.join(s.root, 'h') };
    fs.mkdirSync(env.HOME);
    const args = ['cap', 'audit', '--repo-root', s.repo, '--bench-dir', s.bench, '--base', 'v0', '--out', path.join(s.root, 'o')];
    const plain = spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(fs.existsSync(s.baselineFile), false);
    const upd = spawnSync(process.execPath, [BENCH_JS, ...args, '--update-baseline'], { encoding: 'utf8', env });
    assert.equal(upd.status, 0, upd.stderr);
    assert.match(upd.stdout, /baseline: wrote .*audit-baseline\.json \(2 waived/);
    assert.equal(fs.existsSync(s.baselineFile), true);
  } finally { s.done(); }
});

// ---- capability class ----

test('the registry accepts class uplift or preference, defaults to uplift and rejects other values', () => {
  const s = auditSetup();
  try {
    writeEntry(s.bench, entry());
    let rec = s.audit().report.capabilities.find((c) => c.id === 'skill:alpha');
    assert.equal(rec.class, 'uplift');
    writeEntry(s.bench, entry({ class: 'preference' }));
    rec = s.audit().report.capabilities.find((c) => c.id === 'skill:alpha');
    assert.equal(rec.class, 'preference');
    writeEntry(s.bench, entry({ class: 'weird' }));
    const { report, exitCode } = s.audit();
    assert.equal(exitCode, 1);
    assert.ok(report.findings.some((f) => f.rule === 'registry' && /class/.test(f.msg)));
  } finally { s.done(); }
});

test('a preference capability with lift tasks is warned about, and cap plan refuses to plan its lift', () => {
  const s = auditSetup();
  try {
    writeEntry(s.bench, entry({ class: 'preference' }));
    const { report } = s.audit();
    assert.ok(report.findings.some((f) => f.rule === 'preference-lift-task' && f.level === 'warn' && f.id === 'skill:alpha'));
    const plan = (o = {}) => planCap({ mode: 'lift', cap: 'skill:alpha', base: 'v0', repoRoot: s.repo, benchDir: s.bench, allowRegex: true, budgetCredits: 40, tmpRoot: path.join(s.root, 'tmp'), ...o });
    assert.throws(() => plan(), /preference capability.*fidelity, not lift/);
    assert.match(plan({ force: true }).warnings.join('\n'), /preference capability/);
    writeEntry(s.bench, entry());
    assert.doesNotThrow(() => plan());
    assert.equal(loadRegistry(s.bench).entries.length, 1);
  } finally { s.done(); }
});
