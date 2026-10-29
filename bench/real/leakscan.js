// SPDX-License-Identifier: Apache-2.0
'use strict';

// Looks for copies of a task's fix on the host. For each installed copy of the project it measures how many of
// the fix's added source lines are present in the file at the same place. A copy that is maskable is hidden from
// the agent by the namespace; a copy vendored inside another package cannot be, so a task whose fix sits in one is
// dropped.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mask = require('../runner/lib/real-mask.js');

const MIN_LINE = 20;
const SOURCE_EXT = /\.(py|js|mjs|cjs|ts)$/;
const LEAK_RATIO = 0.6;

// {file -> trimmed added lines of at least MIN_LINE characters} from a unified diff.
function addedLines(patch) {
  const out = new Map();
  let file = null;
  for (const line of String(patch).split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) { file = m[2]; continue; }
    if (!file || !line.startsWith('+') || line.startsWith('+++')) continue;
    const t = line.slice(1).trim();
    if (t.length >= MIN_LINE) out.set(file, [...(out.get(file) || []), t]);
  }
  return out;
}

function scanCopy(copyDir, rel, lines) {
  let text = '';
  try { text = fs.readFileSync(path.join(copyDir, rel), 'utf8'); } catch { return { matched: 0, total: lines.length }; }
  const have = new Set(text.split('\n').map((l) => l.trim()));
  return { matched: lines.filter((l) => have.has(l)).length, total: lines.length };
}

const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch { return []; } };

// The part of a repository path below the package directory: rich/console.py and src/click/core.py give core.py style paths.
function insidePackage(file, names) {
  const parts = file.split('/');
  for (const n of names) {
    const i = parts.lastIndexOf(n);
    if (i >= 0 && i < parts.length - 1) return parts.slice(i + 1).join('/');
  }
  return null;
}

// Returns [{copy, masked, matched, total, ratio}] for every host copy of the project, one per copy and fix file set.
// With baseDir, an added line that the base version of the file already had is not new information and is left out,
// so a copy of the project from before the fix does not score for code the fix merely moved.
function leakScan(entry, patch, { home = os.homedir(), baseDir = null } = {}) {
  const lines = addedLines(patch);
  if (baseDir) {
    for (const [f, ls] of lines) {
      let have = new Set();
      try { have = new Set(fs.readFileSync(path.join(baseDir, f), 'utf8').split('\n').map((l) => l.trim())); } catch { /* a new file has no base */ }
      lines.set(f, ls.filter((l) => !have.has(l)));
    }
  }
  const files = entry.fixFiles.filter((f) => SOURCE_EXT.test(f) && (lines.get(f) || []).length);
  if (!files.length) return [];
  const out = [];
  const add = (copy, masked, relOf) => {
    let matched = 0;
    let total = 0;
    for (const f of files) {
      const rel = relOf(f);
      if (rel === null) continue;
      const s = scanCopy(copy, rel, lines.get(f));
      matched += s.matched; total += s.total;
    }
    if (total) out.push({ copy, masked, matched, total, ratio: matched / total });
  };
  if (entry.language === 'python') {
    const names = [...new Set([...entry.repo.packageNames, ...(entry.test.probeModules || [])])];
    for (const sp of mask.sitePackagesDirs(home)) {
      for (const c of mask.pythonCopies(sp, names)) if (fs.statSync(c).isDirectory() && !/\.(dist|egg)-info$/.test(c)) add(c, true, (f) => insidePackage(f, names));
      for (const c of mask.findVendored(sp, names)) add(c, false, (f) => insidePackage(f, names));
    }
  } else {
    const names = entry.repo.packageNames;
    const roots = [...mask.nodeModulesDirs(home)];
    for (const x of subdirs(path.join(home, '.npm/_npx'))) roots.push(path.join(x, 'node_modules'));
    for (const r of roots) for (const n of names) if (fs.existsSync(path.join(r, n))) add(path.join(r, n), true, (f) => f);
  }
  return out;
}

module.exports = { addedLines, scanCopy, leakScan, LEAK_RATIO, MIN_LINE };
