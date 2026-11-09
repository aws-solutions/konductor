// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, readJson, writeJson } = require('./util.js');

const FROZEN_FILES = { rules: 'survivors.json', scenarios: 'scenarios.json', rubric: 'rubric.json', thresholds: 'thresholds.json' };
const DEFAULT_THRESHOLDS = path.resolve(__dirname, '..', 'thresholds.default.json');
const FREEZE_FILE = 'freeze.json';

const isFrozen = (dir) => fs.existsSync(path.join(dir, FREEZE_FILE));

/** Throws when the skill directory is frozen, so a later command cannot rewrite what the thresholds were registered against. */
function assertNotFrozen(dir, what) {
  if (isFrozen(dir)) throw new Error(`${path.basename(dir)} is frozen; ${what} would change frozen inputs. Start a new evaluation under another skill directory instead.`);
}

function hashesOf(dir) {
  const out = {};
  for (const [key, name] of Object.entries(FROZEN_FILES)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`cannot freeze: ${name} is missing (run the earlier commands first)`);
    out[key] = { file: name, sha256: sha256(fs.readFileSync(file)) };
  }
  return out;
}

/** Writes thresholds.json from the defaults when the skill has none; the noise margin is the one parameter set here. */
function ensureThresholds(dir, { noiseMargin, defaultsFile = DEFAULT_THRESHOLDS } = {}) {
  const file = path.join(dir, FROZEN_FILES.thresholds);
  if (fs.existsSync(file)) {
    if (noiseMargin !== undefined && readJson(file).qualityLoss.noiseMargin !== noiseMargin) throw new Error('thresholds.json already exists with another noise margin; edit it before freezing or delete it');
    return file;
  }
  const t = readJson(defaultsFile);
  if (noiseMargin !== undefined) {
    if (!(noiseMargin >= 0 && noiseMargin <= 1)) throw new Error('--noise-margin must be between 0 and 1');
    t.qualityLoss.noiseMargin = noiseMargin;
  }
  writeJson(file, t);
  return file;
}

function freeze(dir, { skill, source, noiseMargin, now = () => new Date().toISOString() }) {
  const file = path.join(dir, FREEZE_FILE);
  ensureThresholds(dir, { noiseMargin });
  const hashes = hashesOf(dir);
  if (fs.existsSync(file)) {
    const old = readJson(file);
    const same = Object.keys(hashes).every((k) => old.files?.[k]?.sha256 === hashes[k].sha256);
    if (same) return { status: 'unchanged', freeze: old };
    throw new Error(`${skill} is already frozen and its inputs differ from the frozen hashes; run verify to see which`);
  }
  const doc = { schemaVersion: 1, skill, source, frozenAt: now(), files: hashes };
  writeJson(file, doc);
  return { status: 'frozen', freeze: doc };
}

/** {ok, problems}: every frozen file must exist and match its recorded hash. */
function verify(dir) {
  const file = path.join(dir, FREEZE_FILE);
  if (!fs.existsSync(file)) return { ok: false, problems: ['no freeze.json (run freeze first)'] };
  const doc = readJson(file);
  const problems = [];
  for (const [key, rec] of Object.entries(doc.files ?? {})) {
    const f = path.join(dir, rec.file);
    if (!fs.existsSync(f)) problems.push(`${key}: ${rec.file} is missing`);
    else if (sha256(fs.readFileSync(f)) !== rec.sha256) problems.push(`${key}: ${rec.file} changed since the freeze`);
  }
  for (const key of Object.keys(FROZEN_FILES)) if (!doc.files?.[key]) problems.push(`${key}: not recorded in freeze.json`);
  return { ok: problems.length === 0, problems, freeze: doc };
}

module.exports = { freeze, verify, isFrozen, assertNotFrozen, ensureThresholds, FROZEN_FILES, FREEZE_FILE, DEFAULT_THRESHOLDS };
