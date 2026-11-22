// SPDX-License-Identifier: Apache-2.0
'use strict';

// Lint rules that read a task's files, not only its JSON: each catches a bug class that reviews found more than once,
// so a new task cannot bring it back.
//   key-negation   a block key (hidden/<id>/**/key.json) item that fails an answer when its text matches a `none`
//                  pattern, or a `none` item. A correct answer that denies the wrong cause ("not caused by REL-8421")
//                  matches too and loses the item (DEBT D-136). A pattern anchored to the whole value (^...$) is exempt.
//   bare-test-dir  a fixture script or CI file that runs `node --test DIR` on a plain directory. Node 22 and later read
//                  DIR as one file, so the suite fails on an untouched fixture (DEBT D-119). A DIR that resolves as a
//                  module (a package.json main or an index.js, the test/index.js shim) is exempt.
//   fixture-tells  a fixture file that names its trap or how it is graded ("hidden tests will verify", "the tempting
//                  option is ...", a decoy): the agent reads it and the task tests nothing (t3-db-order-history,
//                  t6-idea-feature-bets; DEBT D-155). .bench-answer-key.md is exempt: a run never copies it.
//   claim-negation a substance not_contains check, or a hidden test doesNotMatch, on a pattern that names a cause or
//                  a blame: a correct answer that denies the claim matches too and loses the point (D-136 in block
//                  keys; found again in T6 hidden suites, DEBT D-158). Apply it with doc-key.js contradicts().
//   solution-link  a check that links `solution` to the workspace (`ln -s . solution`) without first moving an
//                  agent-made solution/ aside: ln fails and the whole suite reads as unparsed (DEBT D-144).
// Each finding has a `where` (the key item or file) so lint-baseline.json can hold the known ones by name.

const fs = require('node:fs');
const path = require('node:path');

const anchored = (re) => typeof re === 'string' && re.startsWith('^') && re.endsWith('$');

/** Every key.json under `dir`, relative to it, sorted. */
function keyFiles(dir, rel = '') {
  if (!fs.existsSync(path.join(dir, rel))) return [];
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') out.push(...keyFiles(dir, r));
    else if (e.isFile() && e.name === 'key.json') out.push(r);
  }
  return out.sort();
}

// The unanchored `none` patterns of one block key item ([] when it has none). `denialSafe`: the key is graded by the
// shared block-key.js, whose `none` lists skip a match in a denied claim (`claims`), so only a `none` item's own match
// patterns (a list element that matches is a failure, denied or not) are left.
function nonePatterns(item, { denialSafe = false } = {}) {
  const lists = denialSafe ? [] : [item.none, item.match?.none];
  // A `none` item whose match has its own `none` list carries a hand-written denial guard (t12-spec-rate-limits).
  if (item.type === 'none' && !(Array.isArray(item.match?.none) && item.match.none.length)) lists.push(typeof item.match === 'string' ? [item.match] : item.match?.all ?? []);
  return lists.filter(Array.isArray).flat().filter((re) => !anchored(re));
}

// True when the hidden dir copies in the shared block-key.js (`.bench-lib.json` names it).
function usesSharedBlockKey(hiddenDir) {
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(hiddenDir, '.bench-lib.json'), 'utf8'));
    return Object.values(lib).some((v) => typeof v === 'string' && path.basename(v) === 'block-key.js');
  } catch { return false; }
}

/** key-negation findings of a task whose hidden dir is `hiddenDir`. */
function keyNegationFindings(hiddenDir) {
  const denialSafe = usesSharedBlockKey(hiddenDir);
  const found = [];
  for (const rel of keyFiles(hiddenDir)) {
    let key;
    try { key = JSON.parse(fs.readFileSync(path.join(hiddenDir, rel), 'utf8')); } catch { continue; }
    for (const item of Array.isArray(key?.items) ? key.items : []) {
      const bad = nonePatterns(item ?? {}, { denialSafe });
      if (bad.length) found.push({ rule: 'key-negation', where: `${rel}#${item.id}`, detail: `${rel} item "${item.id}" fails an answer that matches ${JSON.stringify(bad[0])}, even in a denial` });
    }
  }
  return found;
}

// One command line: arguments never run on past a newline (a YAML `run:` line is followed by the next key).
const NODE_TEST_ARGS = /\bnode(?:[ \t]+-\S+)*[ \t]+--test((?:[ \t]+[^\s;&|<>()]+)*)/g;

// The plain-directory arguments of each `node --test` in `text` that do not resolve in `root`.
function bareTestDirs(text, root) {
  const out = [];
  for (const m of String(text).matchAll(NODE_TEST_ARGS)) {
    for (const raw of m[1].trim().split(/\s+/).filter(Boolean)) {
      const arg = raw.replace(/^['"]|['"]$/g, '');
      if (arg.startsWith('-') || /[*?{$]/.test(arg)) continue;
      const full = path.join(root, arg);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      // Node loads DIR as a module: a package.json main or an index.js makes it resolve (the test/index.js shim).
      if (st.isDirectory() && !fs.existsSync(path.join(full, 'package.json')) && !fs.existsSync(path.join(full, 'index.js'))) out.push(arg);
    }
  }
  return out;
}

/** bare-test-dir findings of a fixture: its package.json scripts and its .github/workflows files. */
function bareTestDirFindings(fixtureDir) {
  if (!fixtureDir || !fs.existsSync(fixtureDir)) return [];
  const sources = [];
  const pkg = path.join(fixtureDir, 'package.json');
  if (fs.existsSync(pkg)) {
    try { sources.push(['package.json', Object.values(JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts ?? {}).join('\n')]); } catch { /* not JSON: nothing to read */ }
  }
  const wf = path.join(fixtureDir, '.github', 'workflows');
  if (fs.existsSync(wf)) for (const f of fs.readdirSync(wf).sort()) sources.push([path.join('.github/workflows', f), fs.readFileSync(path.join(wf, f), 'utf8')]);
  const found = [];
  for (const [rel, text] of sources) {
    for (const dir of bareTestDirs(text, fixtureDir)) found.push({ rule: 'bare-test-dir', where: rel, detail: `${rel} runs "node --test ${dir}", which fails on Node 22 and later; use ${dir.replace(/\/$/, '')}/*.test.js` });
  }
  return found;
}

// Words an author's note uses, never a real project file: they tell the agent where the trap is or how it is graded.
const TELLS = [/\bhidden tests?\b/i, /\banswer[- ]key\b/i, /\bred herrings?\b/i, /\bdecoys?\b/i, /\bthe ["']?tempting["']? (option|answer|choice)\b/i, /\b(graded|scored) by the bench\b/i];
// Never copied into a run (isolate.js, contamination.js) or not text the agent reads as project files.
const TELL_SKIP = new Set(['.bench-answer-key.md', 'node_modules', 'dotgit', 'remote.git', '.git']);
const MAX_TELL_BYTES = 512 * 1024;

/** Files under `dir`, relative, skipping TELL_SKIP names; text files only, read lazily by the caller. */
function fixtureFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (TELL_SKIP.has(e.name)) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...fixtureFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** fixture-tells findings: a fixture file that says how the task is graded or names its trap (one per file). */
function fixtureTellFindings(fixtureDir) {
  if (!fixtureDir || !fs.existsSync(fixtureDir)) return [];
  const found = [];
  for (const rel of fixtureFiles(fixtureDir)) {
    const full = path.join(fixtureDir, rel);
    if (fs.statSync(full).size > MAX_TELL_BYTES) continue;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8');
    const re = TELLS.find((x) => x.test(text));
    if (re) found.push({ rule: 'fixture-tells', where: rel, detail: `${rel} says "${text.match(re)[0]}": a fixture must not name its trap or how it is graded` });
  }
  return found;
}

// A pattern that names a cause or a blame: a correct answer that denies it ("the outage did not cause the drop") also
// matches, so it may only be applied denial-safe (doc-key.js contradicts, block-key.js claims).
const CLAIM = /caus|because|due to|blam|led to|drove|responsib/i;
const DOES_NOT_MATCH = /assert\.doesNotMatch\([^,\n]+,\s*(\/(?:[^/\\\n]|\\.)+\/[a-z]*)/g;

/** claim-negation findings: a hidden test asserting doesNotMatch, or a substance not_contains check, on a claim pattern. */
function claimNegationFindings(task, hiddenDir) {
  const found = [];
  (task.checks ?? []).forEach((c, i) => {
    if (c?.type === 'not_contains' && c.kind !== 'format' && typeof c.pattern === 'string' && CLAIM.test(c.pattern)) {
      found.push({ rule: 'claim-negation', where: `checks[${i}]`, detail: `check ${i} fails an answer that denies ${JSON.stringify(c.pattern)}; test it denial-safe in the hidden suite (doc-key.js contradicts)` });
    }
  });
  if (!hiddenDir || !fs.existsSync(hiddenDir)) return found;
  for (const rel of fixtureFiles(hiddenDir).filter((f) => /\.(c?js)$/.test(f) && !/(^|\/)_pristine\//.test(f))) {
    const text = fs.readFileSync(path.join(hiddenDir, rel), 'utf8');
    for (const m of text.matchAll(DOES_NOT_MATCH)) {
      if (CLAIM.test(m[1])) found.push({ rule: 'claim-negation', where: `${rel}:${text.slice(0, m.index).split('\n').length}`, detail: `${rel} asserts doesNotMatch ${m[1]}, which fails a sentence that denies the claim; use contradicts() from doc-key.js` });
    }
  }
  return found;
}

const SOLUTION_LINK = /\bln\s+-[a-z]*s[a-z]*\s+\S+\s+solution\b/;
const SOLUTION_GUARD = /\[\s+-L\s+solution\s+\]/;

/** solution-link findings of a task's checks. */
function solutionLinkFindings(task) {
  return (task.checks ?? []).flatMap((c, i) => (typeof c?.cmd === 'string' && SOLUTION_LINK.test(c.cmd) && !SOLUTION_GUARD.test(c.cmd)
    ? [{ rule: 'solution-link', where: `checks[${i}]`, detail: `check ${i} links solution without moving an agent-made solution/ aside first` }]
    : []));
}

/** All file-based findings of one task read from `file`: [{ rule, where, detail }]. */
function fileFindings(task, file) {
  const dir = path.dirname(file);
  const hiddenDir = typeof task.hidden === 'string' ? path.join(dir, 'hidden', task.hidden) : null;
  const fixtureDir = typeof task.fixture === 'string' ? path.join(dir, 'fixtures', task.fixture) : null;
  return [
    ...(hiddenDir ? keyNegationFindings(hiddenDir) : []),
    ...bareTestDirFindings(fixtureDir),
    ...fixtureTellFindings(fixtureDir),
    ...solutionLinkFindings(task),
    ...claimNegationFindings(task, hiddenDir),
  ];
}

module.exports = { fileFindings, keyNegationFindings, bareTestDirFindings, fixtureTellFindings, claimNegationFindings, bareTestDirs, solutionLinkFindings, nonePatterns };
