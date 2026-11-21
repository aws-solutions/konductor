// SPDX-License-Identifier: Apache-2.0
// Ported from Michael Lin's scripts/bench/lib/baseline.js and baseline-manifest.js (pull request #229 and the baseline series to pull request #271, at commit 33b385f9), same repository and Apache-2.0 licence. His checks are kept; cap changes, dated 2026-11-17, are named below.
/**
 * The frozen-baseline verifier: checks bench/cap/baselines as a whole before any baseline is read. (Not to be confused
 * with cap/baseline.js, the audit-lint ratchet.) Nothing here throws for a bad baseline: problems come back as strings.
 *
 *   verifyBaselines   problems that stop every keep-or-prune run:
 *                       - an entry that is not a skill folder, MANIFEST.json or README.md, or a file that is not
 *                         rules.json, selection.json, tasks-<batch>.json or tasks-<batch>.buckets.json;
 *                       - a file the manifest does not list, a listed file that is gone, a changed hash;
 *                       - credential-shaped text, a home-directory path, or a 12-digit number that is not an AWS
 *                         documentation account id, in any file;
 *                       - a skill whose files fail their format or disagree with each other (readSkillBaseline);
 *                       - a skill the tree no longer has and no identity entry maps (cap);
 *                       - rules.source and manifest.sources that disagree, or one without the other (cap).
 *                     Stale hashes are not problems; they come back as warnings.
 *   readSkillBaseline one skill's files, checked against their formats and each other. Stale is not invalid:
 *                       rulesStale      SKILL.md changed since the rules were written; reading B waits.
 *                       batches[].stale the rules file changed since the tasks were written (tasks rules_sha256).
 *
 * A finding names the file and the kind of text, never the matched value.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadChecked, validateRules, FormatError, MANIFEST_KEY } = require('./baselineformats.js');
const { readFile } = require('./checkedjson.js');

const MANIFEST_NAME = 'MANIFEST.json';
/** cap keeps a README beside the skill folders; his layout had none. */
const ALLOWED_TOP_FILES = new Set([MANIFEST_NAME, 'README.md']);
const SKILL_FOLDER = /^[a-z0-9][a-z0-9-]{0,127}$/;
const TASKS_FILE = /^tasks-([a-z0-9][a-z0-9-]{0,127})\.json$/;

const { sha256 } = require('../runner/lib/util.js');

// The secret shapes of his redact.js (pull request #271) and baseline-manifest.js. Each needs a real value's length.
const SECRET_SHAPES = Object.freeze([
  { name: 'aws_key_id', pattern: /(?<![A-Z0-9])(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[A-Z0-9]{16}(?![A-Z0-9])/g },
  { name: 'secret_key', pattern: /(aws_secret_access_key|secret_?access_?key)(["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40,}/gi },
  { name: 'session_token', pattern: /(aws_session_token|aws_security_token|session_?token|x-amz-security-token)(["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=_%-]{100,}/gi },
  { name: 'sts_token', pattern: /\b(?:IQoJb3JpZ2lu|FwoGZXIvYXdz)[A-Za-z0-9+/=_-]{40,}/g },
  { name: 'bedrock_key', pattern: /\bABSK[A-Za-z0-9+/=]{20,}/g },
  { name: 'bedrock_key', pattern: /(AWS_BEARER_TOKEN_BEDROCK)(\s*[:=]\s*["']?)[A-Za-z0-9+/=_-]{20,}/g },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
  { name: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'github_token', pattern: /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{30,}/g },
  { name: 'slack_token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
]);
/** Values AWS documentation uses as examples: a real secret's shape and no power. */
const KNOWN_EXAMPLES = Object.freeze(['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'AKIAI44QH8DHBEXAMPLE', 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY']);
const AWS_EXAMPLE_ACCOUNTS = Object.freeze(['123456789012', '111122223333', '444455556666']);
// A run of digits inside a longer word is not an account id: a SHA-256 often holds 12 digits in a row.
const TWELVE_DIGITS = /(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/g;
const HOME_PATH = /\/(?:Users|home)\/[^\s/"'\\]+\/|[A-Za-z]:\\{1,2}Users\\{1,2}/;

/** The secret part of a match: after the name and separator for the named shapes, the whole match otherwise. */
const secretOf = (m) => (m[2] === undefined ? m[0] : m[0].slice(m[1].length + m[2].length));

/**
 * Findings for the text of one file: credential-shaped strings, home-directory paths, 12-digit numbers.
 * @param {string} key the file's manifest key, named in each finding
 * @param {string} text its text
 */
function scanText(key, text) {
  const counts = {};
  for (const { name, pattern } of SECRET_SHAPES) {
    for (const m of text.matchAll(pattern)) if (!KNOWN_EXAMPLES.includes(secretOf(m))) counts[name] = (counts[name] || 0) + 1;
  }
  const findings = Object.entries(counts).map(([name, n]) => `${key}: credential-shaped text (${name}, ${n} found)`);
  if (HOME_PATH.test(text)) findings.push(`${key}: a home-directory path`);
  const numbers = (text.match(TWELVE_DIGITS) || []).filter((d) => !AWS_EXAMPLE_ACCOUNTS.includes(d));
  if (numbers.length) findings.push(`${key}: ${numbers.length} 12-digit number(s) that are not AWS documentation account ids (first ends in ${numbers[0].slice(-4)})`);
  return findings;
}

/** The entries of a folder in name order, so findings read the same on every file system. */
const listFolder = (folder) => fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));

/** The batches of a skill folder: the <batch> of each tasks-<batch>.json, in name order. */
const batchesOf = (folder) => (fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => TASKS_FILE.test(f) && !f.endsWith('.buckets.json')).sort().map((f) => TASKS_FILE.exec(f)[1]) : []);

/**
 * One skill's frozen baseline, checked file by file and across files (his loadBaseline).
 * @param {object} o
 * @param {string} o.dir the baselines folder
 * @param {string} o.skillsDir the skills/ folder of the tree under test, for SKILL.md
 * @param {string} o.skill the skill folder name
 * @returns {{ skill, hasBaseline, rules, rulesStale, skillMissing, batches: {batch, tasks, buckets, stale}[], selection, problems, warnings }}
 *   `selection` is the checked selection.json, or null when the baseline has none.
 */
function readSkillBaseline({ dir, skillsDir, skill }) {
  const out = { skill, hasBaseline: false, rules: null, rulesStale: false, skillMissing: false, batches: [], selection: null, problems: [], warnings: [] };
  const folder = path.join(dir, skill);
  const rulesFile = path.join(folder, 'rules.json');
  const batchNames = batchesOf(folder);
  const hasRulesFile = fs.existsSync(rulesFile);
  if (!hasRulesFile && !batchNames.length) return out;
  out.hasBaseline = true;
  const readChecked = (file, kind, context) => {
    const name = path.basename(file);
    try {
      const { data, warnings } = loadChecked(kind, file, context);
      out.warnings.push(...warnings.map((w) => `${name}: ${w}`));
      return data;
    } catch (error) {
      if (!(error instanceof FormatError) && error.code === 'ENOENT') return void out.problems.push(`${name}: file is missing`);
      if (!(error instanceof FormatError)) throw error;
      out.problems.push(...error.errors.map((m) => `${name}: ${m}`));
      return undefined;
    }
  };
  const rules = readChecked(rulesFile, 'rules', { skill });
  const skillMd = path.join(skillsDir, skill, 'SKILL.md');
  out.skillMissing = !fs.existsSync(skillMd);
  if (rules) {
    out.rules = rules;
    // cap: a skill the tree no longer has is stale by definition; whether its name is mapped is verifyBaselines' call.
    out.rulesStale = out.skillMissing || rules.skill_md_sha256 !== sha256(readFile(skillMd));
    // The quotes can only be checked against the text the rules were written from.
    if (!out.rulesStale) out.problems.push(...validateRules(rules, { skill, skillMd: readFile(skillMd, 'utf8') }).errors.map((m) => `rules.json: ${m}`));
  }
  const rulesSha = rules ? sha256(readFile(rulesFile)) : null;
  if (!batchNames.length && hasRulesFile) out.problems.push(`tasks-<batch>.json: no task file for skill "${skill}"; rules.json is there but there are no tasks to run`);
  for (const batch of batchNames) {
    const tasks = readChecked(path.join(folder, `tasks-${batch}.json`), 'tasks', { skill, batch, rules });
    const buckets = readChecked(path.join(folder, `tasks-${batch}.buckets.json`), 'buckets', { rules, tasks });
    if (tasks) out.batches.push({ batch, tasks, buckets: buckets || null, stale: rulesSha !== null && tasks.rules_sha256 !== rulesSha });
  }
  // cap: the selection requests, when the baseline has them (null otherwise).
  const selectionFile = path.join(folder, 'selection.json');
  out.selection = fs.existsSync(selectionFile) ? readChecked(selectionFile, 'selection', { skill }) ?? null : null;
  return out;
}

/** Every baseline file as a Map of "<skill>/<file>" to its path, plus the problems of what else is there. */
function listBaselineFiles(dir) {
  const files = new Map();
  const problems = [];
  const unchecked = new Set();
  for (const entry of listFolder(dir)) {
    if (ALLOWED_TOP_FILES.has(entry.name) && entry.isFile()) continue;
    if (!entry.isDirectory() || !SKILL_FOLDER.test(entry.name)) {
      problems.push(`${entry.name}: only a skill folder, ${MANIFEST_NAME} and README.md belong in the baselines folder`);
      continue;
    }
    for (const file of listFolder(path.join(dir, entry.name))) {
      const key = `${entry.name}/${file.name}`;
      if (!file.isFile() || !MANIFEST_KEY.test(key)) {
        unchecked.add(entry.name);
        problems.push(`${key}: not a baseline file (rules.json, selection.json, tasks-<batch>.json or tasks-<batch>.buckets.json)`);
      } else files.set(key, path.join(dir, entry.name, file.name));
    }
  }
  return { files, problems, unchecked };
}

/** The checked manifest, or null with the reason added to `problems`. */
function readManifest(dir, problems) {
  try {
    return loadChecked('manifest', path.join(dir, MANIFEST_NAME)).data;
  } catch (error) {
    if (error instanceof FormatError) problems.push(...error.errors.map((m) => `${MANIFEST_NAME}: ${m}`));
    else if (error.code === 'ENOENT') problems.push(`${MANIFEST_NAME}: file is missing`);
    else throw error;
    return null;
  }
}

/**
 * cap's provenance and identity checks for one skill (2026-11-17).
 * @param {object} b readSkillBaseline's result
 * @param {object} manifest the checked manifest
 * @param {string} skillsDir the skills/ folder
 * @returns {{ problems: string[], warnings: string[] }}
 */
function provenanceFindings(b, manifest, skillsDir) {
  const problems = [];
  const warnings = [];
  const identity = manifest.identities?.[b.skill] ?? null;
  const entry = manifest.sources?.[b.skill] ?? null;
  if (b.skillMissing && !identity) problems.push(`${b.skill}: the tree has no skills/${b.skill}/SKILL.md and ${MANIFEST_NAME} has no identities entry for it, so the identity is unmapped`);
  if (identity?.how === 'removed') {
    if (!b.skillMissing) problems.push(`${b.skill}: identities says it was removed, but the tree still has skills/${b.skill}/SKILL.md`);
    warnings.push(`${b.skill}: removed; nothing to measure (${identity.note})`);
  } else if (identity) {
    if (!fs.existsSync(path.join(skillsDir, identity.replaced_by, 'SKILL.md'))) problems.push(`${b.skill}: identities.replaced_by names ${identity.replaced_by}, which the tree does not have`);
    warnings.push(`${b.skill}: ${identity.how} into ${identity.replaced_by}; NO DATA until a person approves a migration`);
  }
  const src = b.rules?.source ?? null;
  if (src && !entry) problems.push(`${b.skill}: rules.json has source but ${MANIFEST_NAME} has no sources entry`);
  if (!src && entry) problems.push(`${b.skill}: ${MANIFEST_NAME} has a sources entry but rules.json has no source`);
  if (src && entry && (src.commit !== entry.commit || src.tree !== entry.tree || src.subject.sha256 !== entry.subject_sha256)) problems.push(`${b.skill}: rules.json source and ${MANIFEST_NAME} sources disagree`);
  if (!src && b.rules) warnings.push(`${b.skill}: legacy baseline: rules.json records no source commit and hashed SKILL.md only`);
  return { problems, warnings };
}

/**
 * Checks the whole baselines folder. Throws only the system error of a folder or file that cannot be read.
 * @param {object} o
 * @param {string} o.dir the baselines folder
 * @param {string} o.skillsDir the skills/ folder of the tree under test
 * @returns {{ problems: string[], warnings: string[], fileCount: number, skillCount: number, manifest: object|null, skills: Map }}
 *   `skills` maps each skill folder to its readSkillBaseline result.
 */
function verifyBaselines({ dir, skillsDir }) {
  const { files, problems, unchecked } = listBaselineFiles(dir);
  const warnings = [];
  const manifest = readManifest(dir, problems);
  const listed = manifest?.files ?? null;
  if (listed) for (const key of Object.keys(listed)) if (!files.has(key)) problems.push(`${key}: listed in ${MANIFEST_NAME} but not on disk`);
  for (const [key, file] of files) {
    // One read serves the hash and the scan, so they describe the same bytes.
    const bytes = readFile(file);
    if (listed) {
      if (!Object.hasOwn(listed, key)) problems.push(`${key}: not listed in ${MANIFEST_NAME}`);
      else if (listed[key] !== sha256(bytes)) problems.push(`${key}: hash differs from ${MANIFEST_NAME}`);
    }
    problems.push(...scanText(key, bytes.toString('utf8')));
  }
  const skills = new Map();
  for (const skill of [...new Set([...files.keys()].map((k) => k.split('/')[0]))].filter((s) => !unchecked.has(s))) {
    const b = readSkillBaseline({ dir, skillsDir, skill });
    skills.set(skill, b);
    problems.push(...b.problems.map((m) => `${skill}/${m}`));
    if (b.rulesStale && !b.skillMissing) warnings.push(`${skill}: rules.json is stale, SKILL.md changed since the rules were written`);
    for (const batch of b.batches) if (batch.stale) warnings.push(`${skill}: tasks-${batch.batch}.json is stale, rules.json changed since the tasks were written`);
    if (manifest) {
      const p = provenanceFindings(b, manifest, skillsDir);
      problems.push(...p.problems);
      warnings.push(...p.warnings);
    }
  }
  for (const name of Object.keys(manifest?.identities ?? {})) if (!skills.has(name)) problems.push(`${MANIFEST_NAME}: identities names ${name}, which has no baseline folder`);
  return { problems, warnings, fileCount: files.size, skillCount: skills.size, manifest, skills };
}

module.exports = { MANIFEST_NAME, scanText, readSkillBaseline, verifyBaselines };
