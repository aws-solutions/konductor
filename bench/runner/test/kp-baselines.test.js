// SPDX-License-Identifier: Apache-2.0
// The frozen baselines of cap keep-prune: Michael Lin's 35 baselines, checked by the ported verifier
// (cap/baselineverify.js), the canonical subject manifest of a skill's loaded unit (cap/subjectunit.js), freshness on
// that unit, provenance, renamed or folded identities, and the skills-only rule. No model, no credentials, no spend.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');

const { verifyBaselines } = require('../../cap/baselineverify.js');
const { loadBaseline, baselineStatus, BASELINES_DIR } = require('../../cap/frozen.js');
const { subjectManifest, assertSkillSubject } = require('../../cap/subjectunit.js');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SKILLS = path.join(REPO, 'skills');
const PILOT = 'plan-review';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = (t) => {
  const dir = mkScratch('kpb-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);

/** The pilot's SKILL.md as its frozen baseline was written from (fixtures/keep-prune), so a pilot tree stays fresh after main edits the skill. */
const PILOT_SKILL = path.join(__dirname, 'fixtures', 'keep-prune', 'plan-review-SKILL.md');
const writePilotSkill = (skillsDir) => { fs.mkdirSync(path.join(skillsDir, PILOT), { recursive: true }); fs.copyFileSync(PILOT_SKILL, path.join(skillsDir, PILOT, 'SKILL.md')); };
/** A baselines folder with the pilot alone and a skills folder with the pilot's skill alone. */
function pilotTree(t) {
  const root = tmp(t);
  const dir = path.join(root, 'baselines');
  const skillsDir = path.join(root, 'repo', 'skills');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(BASELINES_DIR, PILOT), path.join(dir, PILOT), { recursive: true });
  writePilotSkill(skillsDir);
  rehash(dir);
  return { root, dir, skillsDir, repo: path.dirname(skillsDir) };
}
/** Rewrites MANIFEST.json's file hashes from the files on disk, keeping its other fields. */
function rehash(dir, extra = {}) {
  const file = path.join(dir, 'MANIFEST.json');
  const old = fs.existsSync(file) ? readJson(file) : { format_version: 1 };
  const files = {};
  for (const s of fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort()) {
    for (const f of fs.readdirSync(path.join(dir, s)).sort()) files[`${s}/${f}`] = sha(fs.readFileSync(path.join(dir, s, f)));
  }
  writeJson(file, { ...old, files, ...extra });
}
/** Turns the pilot into a baseline with `source`: rules.source, matching task hashes and a manifest sources entry. */
function withSource(tree) {
  const unit = subjectManifest({ skillsDir: tree.skillsDir, name: PILOT });
  const src = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const rulesFile = path.join(tree.dir, PILOT, 'rules.json');
  writeJson(rulesFile, { ...readJson(rulesFile), source: { ...src, subject: { sha256: unit.sha256, paths: unit.paths, unresolved: unit.unresolved } } });
  const rulesSha = sha(fs.readFileSync(rulesFile));
  for (const f of fs.readdirSync(path.join(tree.dir, PILOT)).filter((n) => /^tasks-[^.]+\.json$/.test(n))) {
    const file = path.join(tree.dir, PILOT, f);
    writeJson(file, { ...readJson(file), rules_sha256: rulesSha });
  }
  rehash(tree.dir, { sources: { [PILOT]: { ...src, subject_sha256: unit.sha256 } } });
}

test('33 of Michael Lin\'s 35 baselines pass the full verifier against this tree, every one with a status (K-7 retired two)', () => {
  const v = verifyBaselines({ dir: BASELINES_DIR, skillsDir: SKILLS });
  assert.deepEqual(v.problems, []);
  assert.equal(v.skillCount, 33);
  assert.equal(v.fileCount, 165);
  const status = baselineStatus({ skillsDir: SKILLS });
  const by = Object.fromEntries(status.map((s) => [s.skill, s.status]));
  // K-7 (owner yes, 2026-11-24): the folded asana-sprint-planning and adr-generator baselines are retired; the merged
  // skills get fresh baselines in the next approved baseline run.
  assert.equal(by['asana-sprint-planning'], undefined);
  assert.equal(by['adr-generator'], undefined);
  assert.equal(by['dynamodb-validation'], 'removed');
  assert.equal(by['sprint-planning'], 'stale');
  const count = (s) => status.filter((x) => x.status === s).length;
  assert.equal(count('fresh') + count('stale') + count('folded') + count('removed'), 33);
});

test('the verifier refuses an unlisted file, a missing listed file, invalid rules and a repeated key', (t) => {
  const tree = pilotTree(t);
  assert.deepEqual(verifyBaselines(tree).problems, []);
  fs.writeFileSync(path.join(tree.dir, PILOT, 'tasks-extra.json'), '{}');
  assert.ok(verifyBaselines(tree).problems.some((p) => /plan-review\/tasks-extra\.json: not listed in MANIFEST\.json/.test(p)));
  fs.rmSync(path.join(tree.dir, PILOT, 'tasks-extra.json'));
  fs.renameSync(path.join(tree.dir, PILOT, 'tasks-rules-c5.buckets.json'), path.join(tree.root, 'gone.json'));
  assert.ok(verifyBaselines(tree).problems.some((p) => /tasks-rules-c5\.buckets\.json: listed in MANIFEST\.json but not on disk/.test(p)));
  fs.renameSync(path.join(tree.root, 'gone.json'), path.join(tree.dir, PILOT, 'tasks-rules-c5.buckets.json'));
  const rulesFile = path.join(tree.dir, PILOT, 'rules.json');
  const rules = readJson(rulesFile);
  delete rules.rules[0].outcome;
  writeJson(rulesFile, rules);
  rehash(tree.dir);
  assert.ok(verifyBaselines(tree).problems.some((p) => /rules\.json: rules\[0\]\.outcome: required field is missing/.test(p)));
  assert.throws(() => loadBaseline({ name: PILOT, ...tree }), /fail their check/);
  fs.writeFileSync(rulesFile, fs.readFileSync(rulesFile, 'utf8').replace('"format_version": 1,', '"format_version": 1, "format_version": 1,'));
  rehash(tree.dir);
  assert.ok(verifyBaselines(tree).problems.some((p) => /has the key "format_version" twice/.test(p)));
});

test('a task whose rules_sha256 differs from rules.json is stale: a warning, and its reading B waits', (t) => {
  const tree = pilotTree(t);
  const file = path.join(tree.dir, PILOT, 'tasks-rules-b6.json');
  writeJson(file, { ...readJson(file), rules_sha256: 'c'.repeat(64) });
  rehash(tree.dir);
  const v = verifyBaselines(tree);
  assert.deepEqual(v.problems, []);
  assert.ok(v.warnings.some((w) => /tasks-rules-b6\.json is stale, rules\.json changed/.test(w)));
  assert.deepEqual(loadBaseline({ name: PILOT, ...tree }).bWaiting, ['rules-b6']);
});

test('the subject manifest is SKILL.md plus every file in the folder, shared references, and unresolved names', (t) => {
  const pv = subjectManifest({ skillsDir: SKILLS, name: 'policy-validation' });
  assert.deepEqual(pv.paths, ['iam-policy-design/references/compliance-checklists.md', 'policy-validation/SKILL.md']);
  const est = subjectManifest({ skillsDir: SKILLS, name: 'legacy-to-agentic-estimate' });
  assert.ok(est.paths.includes('legacy-to-agentic-estimate/scripts/convert_estimates.py'));
  assert.equal(est.paths.some((p) => p.includes('/evals/')), false, 'evals/ is bench data, never loaded');
  assert.deepEqual(subjectManifest({ skillsDir: SKILLS, name: 'find-aws-skills' }).unresolved, ['find-aws-skills/references/architecture.md']);
  const tree = pilotTree(t);
  const before = subjectManifest({ skillsDir: tree.skillsDir, name: PILOT }).sha256;
  const script = path.join(tree.skillsDir, PILOT, 'run.sh');
  fs.writeFileSync(script, 'echo hi\n');
  const plain = subjectManifest({ skillsDir: tree.skillsDir, name: PILOT }).sha256;
  fs.chmodSync(script, 0o755);
  const exec = subjectManifest({ skillsDir: tree.skillsDir, name: PILOT }).sha256;
  assert.equal(new Set([before, plain, exec]).size, 3, 'a new file and a new execute bit each change the hash');
  fs.symlinkSync(script, path.join(tree.skillsDir, PILOT, 'link.sh'));
  assert.throws(() => subjectManifest({ skillsDir: tree.skillsDir, name: PILOT }), /symbolic link/);
});

test('a baseline with source is fresh until a reference file changes; a legacy one goes stale when a file is added', (t) => {
  const tree = pilotTree(t);
  const ref = path.join(tree.skillsDir, PILOT, 'references', 'notes.md');
  fs.mkdirSync(path.dirname(ref));
  fs.writeFileSync(ref, 'one\n');
  const legacy = loadBaseline({ name: PILOT, ...tree });
  assert.match(legacy.staleWhy, /legacy baseline hashed SKILL\.md only.*plan-review\/references\/notes\.md/);
  withSource(tree);
  const fresh = loadBaseline({ name: PILOT, ...tree });
  assert.equal(fresh.staleWhy, null);
  assert.deepEqual(fresh.recorded, { legacy: false, unitSha256: fresh.unit.sha256, source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } });
  fs.writeFileSync(ref, 'two\n');
  assert.match(loadBaseline({ name: PILOT, ...tree }).staleWhy, /loaded unit changed after the baseline was frozen.*a listed file changed/);
});

test('provenance: rules.source and MANIFEST.json sources must agree, and neither may stand alone', (t) => {
  const tree = pilotTree(t);
  withSource(tree);
  assert.deepEqual(verifyBaselines(tree).problems, []);
  const file = path.join(tree.dir, 'MANIFEST.json');
  const m = readJson(file);
  writeJson(file, { ...m, sources: { [PILOT]: { ...m.sources[PILOT], commit: 'd'.repeat(40) } } });
  assert.ok(verifyBaselines(tree).problems.some((p) => /source and MANIFEST\.json sources disagree/.test(p)));
  delete m.sources;
  writeJson(file, m);
  assert.ok(verifyBaselines(tree).problems.some((p) => /rules\.json has source but MANIFEST\.json has no sources entry/.test(p)));
});

test('a renamed or folded skill is NO DATA until a person approves; an unmapped one fails the check', (t) => {
  const tree = pilotTree(t);
  fs.renameSync(path.join(tree.skillsDir, PILOT), path.join(tree.skillsDir, 'plan-check'));
  assert.ok(verifyBaselines(tree).problems.some((p) => /no identities entry for it, so the identity is unmapped/.test(p)));
  const identity = { replaced_by: 'plan-check', how: 'renamed', note: 'plan-review was renamed plan-check in this test', migration: { approved_by: null, date: null, note: '' } };
  rehash(tree.dir, { identities: { [PILOT]: identity } });
  const b = loadBaseline({ name: PILOT, ...tree });
  assert.match(b.identityWhy, /renamed into plan-check.*NO DATA until a person approves a migration/);
  assert.equal(b.skill.name, 'plan-check');
  rehash(tree.dir, { identities: { [PILOT]: { ...identity, migration: { approved_by: 'a reviewer', date: null, note: '' } } } });
  assert.ok(verifyBaselines(tree).problems.some((p) => /approved_by and date are set together/.test(p)));
  rehash(tree.dir, { identities: { [PILOT]: { ...identity, migration: { approved_by: 'a reviewer', date: '2026-11-17', note: 'tasks reviewed' } } } });
  assert.equal(loadBaseline({ name: PILOT, ...tree }).identityWhy, null);
});

test('only skills are subjects: an agent, a SOP and always-loaded context are refused with the reason', () => {
  assert.throws(() => assertSkillSubject({ repo: REPO, name: 'k-architect' }), /is an agent, not a skill: an agent changes role, tools and model/);
  assert.throws(() => assertSkillSubject({ repo: REPO, name: 'k-code-cleanup' }), /is a SOP, not a skill/);
  assert.throws(() => assertSkillSubject({ repo: REPO, name: 'k-core-rules' }), /not ablatable by this design/);
  assert.throws(() => assertSkillSubject({ repo: REPO, name: 'no-such-thing' }), /is not a skill/);
  assert.doesNotThrow(() => assertSkillSubject({ repo: REPO, name: 'about-konductor' }), 'a name that is a skill and a SOP is checked as the skill');
});

test('a removed skill is mapped, refused with its note, and never blocks the other baselines', (t) => {
  const { runKeepPrune } = require('../../cap/kprun.js');
  const out = tmp(t);
  assert.throws(() => runKeepPrune({ name: 'dynamodb-validation', repo: REPO, runId: 'stub-x', outDir: out, depth: 'quick' }), /dynamodb-validation was removed from the tree, so there is nothing to measure: removed in #219/);
  assert.equal(runKeepPrune({ name: PILOT, repo: REPO, runId: 'stub-y', outDir: out, depth: 'quick' }).record.skill.name, PILOT, 'the other baselines still run');
  const tree = pilotTree(t);
  const removed = { replaced_by: null, how: 'removed', note: 'removed in this test; its job moved elsewhere', migration: { approved_by: null, date: null, note: '' } };
  rehash(tree.dir, { identities: { [PILOT]: removed } });
  assert.ok(verifyBaselines(tree).problems.some((p) => /says it was removed, but the tree still has skills\/plan-review\/SKILL\.md/.test(p)));
  fs.rmSync(path.join(tree.skillsDir, PILOT), { recursive: true });
  assert.deepEqual(verifyBaselines(tree).problems, []);
  assert.deepEqual(baselineStatus(tree).map((s) => s.status), ['removed']);
  assert.throws(() => loadBaseline({ name: PILOT, ...tree }), /nothing to measure: removed in this test/);
  rehash(tree.dir, { identities: { [PILOT]: { ...removed, replaced_by: 'plan-check' } } });
  assert.ok(verifyBaselines(tree).problems.some((p) => /replaced_by is null exactly when how is "removed"/.test(p)));
});
