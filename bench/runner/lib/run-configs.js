// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every command that runs into one --out writes its own run-config. run-config.json is the latest; run-configs/ keeps
// each one, named by its start time, so a later command does not erase what an earlier one recorded.

const fs = require('node:fs');
const path = require('node:path');
const { writeAtomic } = require('./owned.js');

const HISTORY_DIR = 'run-configs';

const { readJsonOrNull: readJson } = require('./util.js');
const stamp = (iso) => String(iso || new Date().toISOString()).replace(/[:.]/g, '-');

function freeName(dir, base) {
  let name = `${base}.json`;
  // '~' sorts after '.', so a second file with the same start time lists after the first.
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}~${String(i).padStart(3, '0')}.json`;
  return name;
}

/** The run-configs recorded in `outDir`, oldest first: the history files, plus a run-config.json written before the history existed. */
function readRunConfigs(outDir) {
  const dir = path.join(outDir, HISTORY_DIR);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { /* no history yet */ }
  const configs = names.map((n) => readJson(path.join(dir, n))).filter(Boolean);
  if (!configs.length) {
    const latest = readJson(path.join(outDir, 'run-config.json'));
    if (latest) configs.push(latest);
  }
  return configs;
}

/**
 * Writes `config` as run-config.json and as run-configs/<startedAt>.json. A run-config.json left by a command that
 * predates the history is copied into run-configs/ first, so it is kept too. Returns the history file's path.
 */
function writeRunConfig(outDir, config) {
  const dir = path.join(outDir, HISTORY_DIR);
  const latestFile = path.join(outDir, 'run-config.json');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    const old = readJson(latestFile);
    if (old) fs.copyFileSync(latestFile, path.join(dir, freeName(dir, stamp(old.startedAt))));
  }
  const text = JSON.stringify(config, null, 2) + '\n';
  const file = path.join(dir, freeName(dir, stamp(config.startedAt)));
  writeAtomic(file, text);
  writeAtomic(latestFile, text);
  return file;
}

module.exports = { readRunConfigs, writeRunConfig, HISTORY_DIR };
