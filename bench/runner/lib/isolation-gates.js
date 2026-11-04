// SPDX-License-Identifier: Apache-2.0
'use strict';

// Two checks that keep a run from touching, or reading, the invoking user's own setup.
//   installs gate: a hash of the real ~/.konductor/installs before and after a run or a batch. A change fails it.
//   claude rules:  a scratch CLAUDE_CONFIG_DIR gets one 0-byte rules file so the host's ~/.claude/rules is not used.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { realHomes } = require('./isolate.js');

const INSTALLS_REL = path.join('.konductor', 'installs');
const GATE_FILE = 'isolation-gate.json';
const EMPTY_RULES_NAME = 'empty.md';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// One line per entry (relative path, kind, content hash), sorted, so a rename, an added 0-byte file and a content
// change all move the hash. A symlink is hashed by its target string and never followed. An entry that cannot be
// listed, inspected or read goes into `errors` instead of being skipped: a gate that cannot see a file has not
// shown that the file is unchanged.
function entries(dir, rel = '', out = [], errors = []) {
  let names;
  try { names = fs.readdirSync(path.join(dir, rel)).sort(); } catch (e) { errors.push({ path: rel || '.', code: e.code || 'ERR' }); return out; }
  for (const name of names) {
    const r = rel ? `${rel}/${name}` : name;
    const abs = path.join(dir, r);
    try {
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) out.push({ path: r, line: `${r}\0link\0${sha(fs.readlinkSync(abs))}` });
      else if (st.isDirectory()) { out.push({ path: r, line: `${r}\0dir` }); entries(dir, r, out, errors); }
      else if (st.isFile()) out.push({ path: r, line: `${r}\0file\0${sha(fs.readFileSync(abs))}`, file: true });
      else out.push({ path: r, line: `${r}\0other` });
    } catch (e) { errors.push({ path: r, code: e.code || 'ERR' }); }
  }
  return out;
}

/**
 * { state: 'absent'|'present'|'unreadable', hash, files, index, errors } for a path. `index` maps each entry to its line.
 * Only a missing path is 'absent'. A regular file is hashed as itself (some hosts keep a file here, not a directory).
 * A path that exists but cannot be read, or is neither a file nor a directory, is 'unreadable'.
 */
function hashDir(dir) {
  const bad = (code) => ({ state: 'unreadable', hash: `unreadable:${code}`, files: 0, errors: [{ path: '.', code }] });
  try { fs.lstatSync(dir); } catch (e) { return e.code === 'ENOENT' ? { state: 'absent', hash: 'absent', files: 0 } : bad(e.code || 'ERR'); }
  let st;
  try { st = fs.statSync(dir); } catch (e) { return bad(e.code || 'ERR'); }
  if (st.isFile()) {
    try {
      const line = `.\0file\0${sha(fs.readFileSync(dir))}`;
      return { state: 'present', hash: sha(line), files: 1, index: { '.': line }, errors: [] };
    } catch (e) { return bad(e.code || 'ERR'); }
  }
  if (!st.isDirectory()) return bad('ENOTSUP');
  const errors = [];
  const list = entries(dir, '', [], errors);
  return {
    state: errors.length ? 'unreadable' : 'present',
    hash: errors.length ? `unreadable:${sha(errors.map((e) => `${e.path}:${e.code}`).join('\n'))}` : sha(list.map((e) => e.line).join('\n')),
    files: list.filter((e) => e.file).length,
    index: Object.fromEntries(list.map((e) => [e.path, e.line])),
    errors,
  };
}

const strip = ({ state, hash, files }) => ({ state, hash, files });

function diffIndex(a, b) {
  const x = a?.index ?? {};
  const y = b?.index ?? {};
  return {
    added: Object.keys(y).filter((k) => !(k in x)).sort(),
    removed: Object.keys(x).filter((k) => !(k in y)).sort(),
    modified: Object.keys(y).filter((k) => k in x && x[k] !== y[k]).sort(),
  };
}

/** The installs directories to gate: one per distinct real home, by resolved path. */
function installsDirs(homes = realHomes()) {
  const seen = new Set();
  for (const h of homes) {
    let real;
    try { real = fs.realpathSync(h); } catch { real = path.resolve(h); }
    seen.add(path.join(real, INSTALLS_REL));
  }
  return [...seen];
}

// BENCH_GATE_HOMES (comma separated) replaces the real homes the gate watches. It is a test seam: honored only when
// BENCH_TEST_MODE=1, so a stray variable in a study shell cannot point the gate away from the real installs.
let warnedGateHomes = false;
function homesFromEnv() {
  const v = process.env.BENCH_GATE_HOMES;
  if (!v) return undefined;
  if (process.env.BENCH_TEST_MODE !== '1') {
    if (!warnedGateHomes) { process.stderr.write('warning: BENCH_GATE_HOMES is ignored unless BENCH_TEST_MODE=1; the gate watches the real homes\n'); warnedGateHomes = true; }
    return undefined;
  }
  return v.split(',').filter(Boolean);
}

/**
 * A gate over the real installs directories. `begin()` hashes them; `end()` hashes again and returns
 * { ok, changed: [{ dir, before, after, added, removed, modified }], unreadable: [{ dir, errors }] }.
 * The gate fails when a hash differs or when either hash could not be taken.
 */
function createInstallsGate({ homes } = {}) {
  const dirs = installsDirs(homes ?? homesFromEnv());
  return {
    dirs,
    begin() {
      const before = dirs.map((d) => hashDir(d));
      return {
        end() {
          const changed = [];
          const unreadable = [];
          dirs.forEach((dir, i) => {
            const after = hashDir(dir);
            const errors = [...(before[i].errors || []).map((e) => ({ ...e, when: 'before' })), ...(after.errors || []).map((e) => ({ ...e, when: 'after' }))];
            if (errors.length) unreadable.push({ dir, errors });
            if (after.hash === before[i].hash) return;
            changed.push({ dir, before: strip(before[i]), after: strip(after), ...diffIndex(before[i], after) });
          });
          return { ok: changed.length === 0 && unreadable.length === 0, changed, unreadable };
        },
      };
    },
  };
}

/** One line for a log or an error message. */
function describeChange(result) {
  if (result.ok) return 'the real ~/.konductor/installs did not change';
  const unread = (result.unreadable || []).map((u) => `${u.dir} could not be read (${u.errors.slice(0, 3).map((e) => `${e.path}: ${e.code}`).join(', ')})`);
  if (!result.changed.length || result.changed.every((c) => c.before.state === 'unreadable' || c.after.state === 'unreadable')) {
    return `the real ~/.konductor/installs gate failed closed: ${unread.join(' | ')}`;
  }
  const parts = result.changed.map((c) => {
    const bits = [['added', c.added], ['removed', c.removed], ['modified', c.modified]].filter(([, l]) => l.length).map(([k, l]) => `${k} ${l.slice(0, 5).join(', ')}${l.length > 5 ? ` and ${l.length - 5} more` : ''}`);
    const state = c.before.state !== c.after.state ? `${c.before.state} -> ${c.after.state}` : '';
    return `${c.dir}: ${[...bits, state].filter(Boolean).join('; ') || 'changed'}`;
  });
  return `the real ~/.konductor/installs changed (${[...parts, ...unread].join(' | ')})`;
}

/**
 * Makes `<configDir>/rules` hold exactly one 0-byte file and returns its path. Refuses the invoking user's own
 * ~/.claude so a mistake cannot empty the real rules.
 */
function ensureEmptyClaudeRules(configDir, { homes } = {}) {
  const abs = path.resolve(configDir);
  for (const h of homes ?? realHomes()) {
    let real;
    try { real = fs.realpathSync(h); } catch { real = path.resolve(h); }
    if (abs === path.join(real, '.claude') || abs === path.join(path.resolve(h), '.claude')) throw new Error(`refused: ${abs} is the real Claude config directory`);
  }
  const rules = path.join(abs, 'rules');
  fs.rmSync(rules, { recursive: true, force: true });
  fs.mkdirSync(rules, { recursive: true });
  const file = path.join(rules, EMPTY_RULES_NAME);
  fs.writeFileSync(file, '');
  return file;
}

module.exports = { hashDir, installsDirs, createInstallsGate, describeChange, ensureEmptyClaudeRules, INSTALLS_REL, GATE_FILE, EMPTY_RULES_NAME };
