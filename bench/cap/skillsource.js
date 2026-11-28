// SPDX-License-Identifier: Apache-2.0
'use strict';

// A skill baseline source (design: bench/docs/history/skill-author-design-2026-11-28.md) turned into a draft baseline
// folder in the frozen format: rules.json with `source`, two task batches with their bucket sidecars (derived from the
// rule number of each rubric item), and selection.json picked from the skill's skill-evals queries. Every file is
// checked by the frozen validators before anything is written, and the whole folder by the frozen verifier after.
// Free: no model call. `cap skill-author --from-source` and the paid author (skillauthor.js) both end here.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const f = require('./baselineformats.js');
const { verifyBaselines, MANIFEST_NAME } = require('./baselineverify.js');
const { subjectManifest, subjectSource } = require('./subjectunit.js');

const DRAFTS_DIR = path.join(__dirname, 'baseline-drafts');
const PER_KIND = 5;
const BUCKET = Object.freeze({ useful: 'value', style: 'format', generic: 'guard' });
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const ruleId = (skill, n) => `${skill}-r${String(n).padStart(2, '0')}`;
const queriesOf = (repo, skill) => JSON.parse(fs.readFileSync(path.join(repo, 'bench', 'skill-evals', 'skills', skill, 'queries.json'), 'utf8'));

/** The first 5 should-load and 5 should-not queries of the skill that do not name it: { load: [i..], none: [i..] }. */
function defaultSelection({ repo, skill }) {
  const ok = queriesOf(repo, skill).map((q, i) => ({ i, q })).filter(({ q }) => !f.namesSkill(f.normalizeForMatch(q.query), skill));
  const pick = (want) => ok.filter(({ q }) => q.should_trigger === want).slice(0, PER_KIND).map(({ i }) => i);
  return { load: pick(true), none: pick(false) };
}

/**
 * The file objects of one source, in write order: [[file name, object, kind, context]]. A task may carry `n`, its
 * number in the batch, so a dropped task leaves a gap instead of renumbering the rest.
 */
function filesOf(source, { repo }) {
  const { skill } = source;
  const skillMd = fs.readFileSync(path.join(repo, 'skills', skill, 'SKILL.md'));
  const unit = subjectManifest({ skillsDir: path.join(repo, 'skills'), name: skill });
  const src = subjectSource({ repo, name: skill });
  const rules = source.rules.map((r, i) => ({ id: ruleId(skill, i + 1), source_quote: r.q, class: r.c, outcome: r.o, why: r.w ?? '', scenario_hint: r.h }));
  const rulesFile = { format_version: 1, skill, skill_md_sha256: sha256(skillMd), request_context: source.request_context, rules,
    source: { commit: src.commit, tree: src.tree, subject: { sha256: unit.sha256, paths: unit.paths, unresolved: unit.unresolved } } };
  const rulesSha = sha256(json(rulesFile));
  const model = source.reviewedBy ? `${source.writtenBy}; reviewed by ${source.reviewedBy}` : source.writtenBy;
  const out = [['rules.json', rulesFile, 'rules', { skill, skillMd: skillMd.toString('utf8') }]];
  for (const [batch, tasks] of Object.entries(source.batches)) {
    const ids = tasks.map((t, i) => `${skill}-${batch}-${t.n ?? i + 1}`);
    const tf = { format_version: 1, skill, batch, generated_at: source.generatedAt ?? new Date().toISOString(), model,
      skills_version: `konductor@${String(src.commit).slice(0, 8)}`, rules_sha256: rulesSha,
      scenarios: tasks.map((t, i) => ({ id: ids[i], title: t.title, target_section: t.section, prompt: t.prompt, rubric: t.rubric.map(([, text]) => text), why_skill_matters: t.why })) };
    const bk = { format_version: 1, skill, batch,
      rules: Object.fromEntries(rules.map((r) => [r.id, { class: r.class, kept: r.class !== 'style', bucket: BUCKET[r.class] }])),
      scenarios: Object.fromEntries(tasks.map((t, i) => [ids[i], Object.fromEntries(t.rubric.map(([n], j) => [String(j + 1), { bucket: BUCKET[rules[n - 1]?.class] ?? 'value', rule_id: ruleId(skill, n) }]))])) };
    out.push([`tasks-${batch}.json`, tf, 'tasks', { skill, batch, rules: rulesFile }], [`tasks-${batch}.buckets.json`, bk, 'buckets', { rules: rulesFile, tasks: tf }]);
  }
  const q = queriesOf(repo, skill);
  const sel = source.selection ?? defaultSelection({ repo, skill });
  const pick = (idx, expect) => idx.map((i) => ({ id: `${skill}-sel-${expect}-${i}`, prompt: q[i].query, expect, note: `skill-evals queries.json #${i}` }));
  out.push(['selection.json', { format_version: 1, skill, requests: [...pick(sel.load, 'load'), ...pick(sel.none, 'none')] }, 'selection', { skill }]);
  return { files: out, manifestSource: { commit: src.commit, tree: src.tree, subject_sha256: unit.sha256 } };
}

const VALIDATE = { rules: f.validateRules, tasks: f.validateTasks, buckets: f.validateBuckets, selection: f.validateSelection };

/**
 * Checks every file of `source`, then writes them to `<out>/<skill>/` (replacing that skill's old draft files) and
 * merges their hashes and source into `<out>/MANIFEST.json`. Throws, writing nothing, when any file fails its format.
 * Returns { dir, problems }: the frozen verifier's problems over the whole folder after the write (empty when good).
 * @param {object} o
 * @param {object} o.source the parsed source (design note, "One source format")
 * @param {string} o.repo the repository whose skills/ and bench/skill-evals/ it reads
 * @param {string} [o.out] the drafts folder (default bench/cap/baseline-drafts)
 */
function writeDraft({ source, repo, out = DRAFTS_DIR }) {
  const { files, manifestSource } = filesOf(source, { repo });
  const errors = files.flatMap(([name, obj, kind, ctx]) => VALIDATE[kind](obj, ctx).errors.map((m) => `${name}: ${m}`));
  if (errors.length) throw new Error(`${source.skill}: the source fails the baseline format, nothing written:\n  ${errors.join('\n  ')}`);
  const dir = path.join(out, source.skill);
  const manifestFile = path.join(out, MANIFEST_NAME);
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { format_version: 1, files: {}, sources: {} };
  for (const key of Object.keys(manifest.files).filter((k) => k.startsWith(`${source.skill}/`))) {
    fs.rmSync(path.join(out, key), { force: true });
    delete manifest.files[key];
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, obj] of files) {
    fs.writeFileSync(path.join(dir, name), json(obj));
    manifest.files[`${source.skill}/${name}`] = sha256(fs.readFileSync(path.join(dir, name)));
  }
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
  manifest.sources = { ...manifest.sources, [source.skill]: manifestSource };
  fs.writeFileSync(manifestFile, json(manifest));
  return { dir, problems: verifyBaselines({ dir: out, skillsDir: path.join(repo, 'skills') }).problems };
}

module.exports = { DRAFTS_DIR, defaultSelection, filesOf, writeDraft };
