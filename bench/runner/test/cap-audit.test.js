// SPDX-License-Identifier: Apache-2.0
'use strict';

// Static audit on a synthetic repo: description lint, bytes, near duplicates, reachability, inbound references,
// startup bytes, task coverage, leakage and the public-hygiene scan. No model, no credits.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch, ALPHA_DESC } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { runAudit, renderAudit } = require('../../cap/audit.js');
const { jaccard, descTokens, shingles, overlapFraction } = require('../../cap/text.js');
const { scoringOf } = require('../../cap/captasks.js');
const { loadTasks } = require('../lib/tasks.js');

// Built from parts so this file carries no internal marker itself.
const MARKER = ['mid', 'way'].join('');

function setup(entries = []) {
  const root = scratch();
  const r = makeCapRepo(root);
  const bench = makeCapBench(root);
  for (const e of entries) writeEntry(bench, e);
  const audit = (over = {}) => runAudit({ repo: r.repo, base: 'v0', harness: 'both', benchDir: bench, ...over });
  return { root, bench, repo: r.repo, audit, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const cap = (rep, id) => rep.capabilities.find((c) => c.id === id);
const finding = (rep, rule, id) => rep.findings.find((f) => f.rule === rule && (!id || f.id === id));

test('description metrics: presence, length, style, use-when cue and finder keywords', () => {
  const s = setup();
  try {
    const { report } = s.audit();
    const a = cap(report, 'skill:alpha').description;
    assert.deepEqual([a.present, a.length, a.style, a.useWhen], [true, ALPHA_DESC.length, 'plain', true]);
    assert.ok(a.keywords.includes('backend') && a.keywords.includes('injection'), a.keywords.join());
    assert.ok(!a.keywords.includes('for') && !a.keywords.includes('and'));
    const b = cap(report, 'skill:beta').description;
    assert.equal(b.style, 'folded');
    assert.ok(b.length > 60, `a folded description is read by its text, got ${b.length}`);
    assert.ok(b.useWhen);
    assert.equal(finding(report, 'description-block-scalar', 'skill:beta').level, 'warn');
    assert.equal(cap(report, 'skill:gamma').description.present, false);
  } finally { s.done(); }
});

test('a skill with no description is an error and fails the audit; warnings alone do not', () => {
  const s = setup();
  try {
    const bad = s.audit();
    assert.equal(finding(bad.report, 'description-missing', 'skill:gamma').level, 'error');
    assert.equal(bad.exitCode, 1);
  } finally { s.done(); }
});

test('exit code is 0 when only warnings are present', () => {
  const root = scratch();
  try {
    const r = makeCapRepo(root, {
      files: (repo) => {
        write(path.join(repo, 'skills/only/SKILL.md'), '---\nname: only\ndescription: Short.\n---\nbody\n');
        write(path.join(repo, 'agents/konductor.agent-spec.json'), JSON.stringify({ name: 'konductor', config: { systemPrompt: 'p' }, dependencies: { skills: { skillNames: [] } } }));
      },
    });
    const bench = makeCapBench(root);
    const { report, exitCode } = runAudit({ repo: r.repo, base: 'v0', harness: 'both', benchDir: bench });
    assert.ok(report.findings.some((f) => f.level === 'warn'));
    assert.ok(!report.findings.some((f) => f.level === 'error'), JSON.stringify(report.findings));
    assert.equal(exitCode, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bytes are the file size and the token figure is chars/4, labelled an estimate', () => {
  const s = setup();
  try {
    const { report } = s.audit();
    const a = cap(report, 'skill:alpha');
    assert.equal(a.bytes, fs.statSync(path.join(s.repo, 'skills/alpha/SKILL.md')).size);
    assert.equal(a.estTokens, Math.round(a.bytes / 4));
    assert.match(report.notes.join(' '), /estimate/);
  } finally { s.done(); }
});

test('jaccard is intersection over union of description tokens; stop words and short words drop out', () => {
  assert.deepEqual([...descTokens('Use when the cat sat on a mat')].sort(), ['cat', 'mat', 'sat']);
  assert.equal(jaccard(new Set(['a1x', 'b2x']), new Set(['a1x', 'b2x'])), 1);
  assert.equal(jaccard(new Set(['aaa', 'bbb', 'ccc']), new Set(['bbb', 'ccc', 'ddd'])), 0.5);
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test('near duplicates list the top neighbours by score, most similar first', () => {
  const s = setup();
  try {
    const { report } = s.audit();
    const n = cap(report, 'skill:alpha').neighbours;
    assert.equal(n[0].id, 'skill:delta');
    assert.ok(n[0].score > 0.5 && n[0].score < 1, String(n[0].score));
    assert.ok(n.length <= 3);
    assert.ok(n[0].score >= (n[1]?.score ?? 0));
    assert.deepEqual(cap(report, 'skill:delta').neighbours[0].id, 'skill:alpha');
  } finally { s.done(); }
});

test('reachability: agents per capability, unreachable and single-agent skills, dangling listings', () => {
  const s = setup();
  try {
    const { report } = s.audit();
    assert.deepEqual(cap(report, 'skill:alpha').reach.kiro.agents, ['k-dev', 'konductor']);
    assert.deepEqual(cap(report, 'skill:gamma').reach.kiro.agents, []);
    assert.equal(finding(report, 'unreachable-kiro', 'skill:gamma').level, 'warn');
    assert.equal(finding(report, 'unreachable-kiro', 'sop:k-orphan').level, 'warn');
    assert.deepEqual(report.summary.kiro.singleAgentSkills.sort(), ['beta', 'delta']);
    assert.deepEqual(report.summary.kiro.unreachableSkills, ['gamma']);
    assert.deepEqual(report.summary.kiro.skillsPerAgent, { 'k-dev': 2, konductor: 2 });
    assert.deepEqual(report.dangling, [{ agent: 'k-dev', kind: 'skill', name: 'ghost' }]);
    assert.ok(finding(report, 'dangling-listing'));
    assert.equal(cap(report, 'skill:gamma').reach.opencode, true);
  } finally { s.done(); }
});

test('--harness opencode drops the kiro-only sections and findings', () => {
  const s = setup();
  try {
    const { report } = s.audit({ harness: 'opencode' });
    assert.equal(finding(report, 'unreachable-kiro'), undefined);
    assert.equal(report.summary.kiro, null);
    assert.equal(cap(report, 'skill:alpha').reach.kiro, null);
    assert.equal(report.startup.kiro, null);
    const idx = report.startup.opencode;
    const expected = ['alpha', 'beta', 'delta', 'gamma'].reduce((n, name) => {
      const c = cap(report, `skill:${name}`);
      return n + Buffer.byteLength(name) + Buffer.byteLength(c.description.text);
    }, 0);
    assert.equal(idx.skillIndexBytes, expected);
    assert.equal(idx.skillCount, 4);
  } finally { s.done(); }
});

test('inbound references come from other skills, SOPs, context files and agent prompts, not from itself or the lists', () => {
  const s = setup();
  try {
    const { report } = s.audit();
    const from = (id) => cap(report, id).inbound.map((r) => r.from).sort();
    assert.deepEqual(from('skill:alpha'), ['agent:konductor', 'skill:delta', 'skill:gamma']);
    assert.deepEqual(from('sop:k-plan'), ['context:routing']);
    assert.deepEqual(from('skill:beta'), [], 'the dependency lists are not references');
  } finally { s.done(); }
});

test('startup bytes per kiro agent are the prompt plus the context files it lists', () => {
  const s = setup();
  try {
    const { report } = s.audit();
    const k = report.startup.kiro.find((a) => a.agent === 'konductor');
    const prompt = Buffer.byteLength('Orchestrate. Use the alpha skill when needed.');
    const ctx = ['context/routing.md', 'context/core.md'].reduce((n, f) => n + fs.statSync(path.join(s.repo, f)).size, 0);
    assert.equal(k.promptBytes, prompt);
    assert.equal(k.contextBytes, ctx);
    assert.equal(k.totalBytes, prompt + ctx);
    assert.equal(k.estTokens, Math.round((prompt + ctx) / 4));
    assert.equal(k.unsizedResources, 2, 'AGENTS.md and the skill glob resolve against the run cwd');
  } finally { s.done(); }
});

test('task coverage: registry links count, the target field is informational, and a gap is named', () => {
  const s = setup([entry({ tasks: { lift: ['rev-one'], trigger: [], headroom: {} } })]);
  try {
    write(path.join(s.bench, 'tasks/tgt.json'), JSON.stringify({ id: 'tgt', class: 'review', target: 'delta', prompt: 'Review it.', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c', criterion: 'x', weight: 1 }], tiers: ['lite'] }));
    const { report } = s.audit();
    assert.deepEqual(cap(report, 'skill:alpha').tasks.linked, ['rev-one']);
    assert.equal(cap(report, 'skill:alpha').tasks.gap, null);
    assert.deepEqual(cap(report, 'skill:delta').tasks.byTarget, ['tgt']);
    assert.equal(cap(report, 'skill:delta').tasks.gap, 'target only: no registry link');
    assert.equal(cap(report, 'skill:beta').tasks.gap, 'no task');
    assert.equal(finding(report, 'target-not-linked'), undefined, 'delta is unregistered, so there is nothing to link');
    assert.equal(report.summary.coverage.withTask, 2);
  } finally { s.done(); }
});

test('a task whose target names a registered capability that does not list it is a warning', () => {
  const s = setup([entry({ tasks: { lift: [], trigger: [], headroom: {} } })]);
  try {
    write(path.join(s.bench, 'tasks/tgt.json'), JSON.stringify({ id: 'tgt', class: 'review', target: 'alpha', prompt: 'Review it.', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c', criterion: 'x', weight: 1 }], tiers: ['lite'] }));
    assert.equal(finding(s.audit().report, 'target-not-linked', 'skill:alpha').level, 'warn');
  } finally { s.done(); }
});

test('a linked task whose prompt names the capability is flagged', () => {
  const s = setup([entry({ tasks: { lift: ['named'], trigger: [], headroom: {} } })]);
  try {
    write(path.join(s.bench, 'tasks/named.json'), JSON.stringify({ id: 'named', class: 'review', target: null, prompt: 'Use the alpha skill to review this.', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c', criterion: 'x', weight: 1 }], tiers: ['lite'] }));
    assert.equal(finding(s.audit().report, 'prompt-names-capability', 'skill:alpha').level, 'warn');
  } finally { s.done(); }
});

test('scoringOf separates hidden tests, a rubric and checks alone', () => {
  const s = setup();
  try {
    const t = loadTasks(s.bench);
    assert.equal(scoringOf(t.get('hid-one')), 'hidden');
    assert.equal(scoringOf(t.get('rev-one')), 'rubric');
    assert.equal(scoringOf(t.get('rx-one')), 'regex-only');
  } finally { s.done(); }
});

test('a regex-only lift task is a warning in the audit', () => {
  const s = setup([entry({ tasks: { lift: ['rx-one'], trigger: [], headroom: {} } })]);
  try { assert.equal(finding(s.audit().report, 'lift-task-regex-only', 'skill:alpha').level, 'warn'); } finally { s.done(); }
});

test('shingles overlap counts the share of the task text found in the capability text', () => {
  const body = 'always validate every input and escape output before you report findings with severity';
  const copied = 'we always validate every input and escape output before you report anything today';
  const a = shingles(copied, 8);
  assert.equal(overlapFraction(a, shingles(body, 8)), 3 / a.size);
  assert.equal(overlapFraction(shingles('too short', 8), shingles(body, 8)), 0);
  assert.equal(overlapFraction(shingles('entirely different words about gardening and the weather today in spring', 8), shingles(body, 8)), 0);
});

test('leakage above 5% fails the audit; a clean task passes', () => {
  const s = setup([entry({ tasks: { lift: ['leaky', 'rev-one'], trigger: [], headroom: {} } })]);
  try {
    write(path.join(s.bench, 'tasks/leaky.json'), JSON.stringify({ id: 'leaky', class: 'review', target: null, prompt: 'Please validate every input. Escape output. Report findings with severity. Then finish the report.', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c', criterion: 'x', weight: 1 }], tiers: ['lite'] }));
    const { report, exitCode } = s.audit();
    const hits = report.findings.filter((f) => f.rule === 'leakage');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].msg, /leaky/);
    assert.equal(hits[0].level, 'error');
    assert.equal(exitCode, 1);
    const l = cap(report, 'skill:alpha').leakage;
    assert.equal(l.find((x) => x.task === 'rev-one').max, 0);
    assert.ok(l.find((x) => x.task === 'leaky').max > 0.05);
  } finally { s.done(); }
});

test('leakage also reads fixtures and hidden tests of the linked task', () => {
  const s = setup([entry({ tasks: { lift: ['hid-one'], trigger: [], headroom: {} } })]);
  try {
    write(path.join(s.bench, 'tasks/hidden/hid-one/copy.test.js'), '// Validate every input. Escape output. Report findings with severity.\nconst x = 1;\n');
    const l = cap(s.audit().report, 'skill:alpha').leakage.find((x) => x.task === 'hid-one');
    assert.ok(l.hidden > 0.05, JSON.stringify(l));
  } finally { s.done(); }
});

test('--public flags internal markers in registry text, task prompts and docs; without it the scan is off', () => {
  const s = setup([entry({ notes: `owner reviews in ${MARKER} sessions` })]);
  try {
    write(path.join(s.bench, 'tasks/p.json'), JSON.stringify({ id: 'p', class: 'review', target: null, prompt: `Mention ${MARKER} here.`, fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c', criterion: 'x', weight: 1 }], tiers: ['lite'] }));
    write(path.join(s.bench, 'README.md'), `see the ${MARKER} docs\n`);
    assert.equal(finding(s.audit().report, 'public-marker'), undefined);
    const pub = s.audit({ pub: true }).report.findings.filter((f) => f.rule === 'public-marker');
    assert.deepEqual(pub.map((f) => f.where).sort(), ['README.md', 'capabilities/skill/alpha.json', 'tasks/p.json']);
    assert.ok(pub.every((f) => f.level === 'error'));
  } finally { s.done(); }
});

test('registry findings are part of the audit and registry errors fail it', () => {
  const s = setup([entry({ path: 'skills/missing/SKILL.md' })]);
  try {
    const { report, exitCode } = s.audit();
    assert.ok(report.registry.findings.some((f) => /does not exist at the base ref/.test(f.msg)));
    assert.ok(report.findings.some((f) => f.rule === 'registry' && f.level === 'error'));
    assert.equal(exitCode, 1);
  } finally { s.done(); }
});

test('the markdown report lists the sections and the JSON report is serialisable', () => {
  const s = setup([entry()]);
  try {
    const { report } = s.audit();
    const md = renderAudit(report);
    for (const h of ['# Capability audit', '## Summary', '## Descriptions', '## Reachability', '## Startup bytes', '## Near duplicates', '## Findings']) assert.ok(md.includes(h), h);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
    assert.equal(report.base.kind, 'git');
    assert.match(report.base.commitSha, /^[0-9a-f]{40}$/);
  } finally { s.done(); }
});

test('an audit does not change the working tree of the repo it reads', () => {
  const s = setup([entry()]);
  try {
    fs.writeFileSync(path.join(s.repo, 'skills/alpha/SKILL.md'), 'edited\n');
    const { report } = s.audit();
    assert.ok(cap(report, 'skill:alpha').description.present, 'read from the tag, not the edited file');
    assert.equal(fs.readFileSync(path.join(s.repo, 'skills/alpha/SKILL.md'), 'utf8'), 'edited\n');
  } finally { s.done(); }
});
