#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Finds the unbound-variable class in bench shell scripts that run under `set -u` (DEBT D-157): a `local NAME` declared
// only inside a branch (if/elif/else, a case arm, a loop body) and read after that branch, where the path that skips
// the branch dies with "NAME: unbound variable". A free dry run that takes the binding branch never sees it (the
// 2026-11-21 PAID wave-0 run died this way on `log` and `pinbak`, nothing spent).
// A read as ${NAME:-...}, ${NAME-...}, ${NAME:=...} or ${NAME+...} is safe and not reported.
//   node bench/scripts/shell-unbound.js [FILE|DIR ...]   (default: bench/ and scripts/ of the repository)
// Exit 1 when it finds one. shortcut: a line-based reader, not a shell parser; a branch keyword inside a heredoc or a
// one-line `[ x ] && { local y; }` group is not seen. Upgrade to shellcheck's SC2154 flow analysis once shellcheck is
// installed on the bench host (it is not, 2026-11-21).

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dotgit', 'remote.git', 'fixtures', 'solutions', 'answers', 'hidden']);

/** The line with quoted strings blanked and any trailing comment cut, for finding keywords. */
function code(line) {
  let out = '';
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\' && q === '"') { i++; continue; } if (c === q) q = null; out += ' '; continue; }
    if (c === '\\') { out += '  '; i++; continue; }
    if (c === "'" || c === '"') { q = c; out += ' '; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += c;
  }
  return out;
}

const KEY = /(?:^|[\s;&|(])(if|then|elif|else|fi|case|esac|do|done)(?=$|[\s;&|)])/g;
const ARM = /^\s*[^\s()][^()]*\)(?!\))/; // a case arm label like `foo | bar)` at the start of a line
const LOCAL = /(?:^|[\s;&|])(?:local|declare|typeset)((?:\s+-[a-zA-Z]+)*)((?:\s+[A-Za-z_][A-Za-z0-9_]*(?:=\S*)?)+)/g;
const READ = /\$(?:\{(#?)([A-Za-z_][A-Za-z0-9_]*)([^}]?)|([A-Za-z_][A-Za-z0-9_]*))/g;

/** Findings of one script's text: [{ line, name, declaredAt }]. Only scripts that turn on `set -u` are read. */
function scan(text) {
  if (!/^\s*set\s+-[a-zA-Z]*u|^\s*set\s+-o\s+nounset/m.test(text)) return [];
  const lines = text.split('\n');
  const found = [];
  let fn = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (!fn) {
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{/.test(raw) && !/\}\s*(#.*)?$/.test(raw.replace(/^[^{]*\{/, ''))) fn = { stack: [], ids: 0, decls: new Map(), line: n + 1 };
      continue;
    }
    if (raw === '}') { fn = null; continue; }
    const c = code(raw);
    // A case arm label opens the next arm before anything on its line is read.
    if (fn.stack.length && fn.stack[fn.stack.length - 1].kind === 'case' && ARM.test(c) && !/^\s*(esac|case)\b/.test(c)) {
      fn.stack[fn.stack.length - 1].branch++;
    }
    // Reads first: a line that declares and reads (`local x=$x`) reads the outer value.
    for (const m of raw.matchAll(READ)) {
      const name = m[2] ?? m[4];
      const safe = m[2] !== undefined && /[:\-=+]/.test(m[3] ?? '');
      const decl = fn.decls.get(name);
      if (safe || !decl) continue;
      const here = fn.stack.map((f) => `${f.id}.${f.branch}`);
      const covered = decl.some((d) => d.path.every((p, i) => here[i] === p));
      if (!covered && !found.some((f) => f.name === name && f.fnLine === fn.line)) found.push({ line: n + 1, name, fnLine: fn.line, declaredAt: decl.map((d) => d.line) });
    }
    const events = [];
    for (const m of c.matchAll(KEY)) events.push({ at: m.index, kw: m[1] });
    for (const m of c.matchAll(LOCAL)) events.push({ at: m.index, names: m[2].trim().split(/\s+/).map((x) => x.split('=')[0]) });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      const top = fn.stack[fn.stack.length - 1];
      if (e.names) {
        const p = fn.stack.map((f) => `${f.id}.${f.branch}`);
        for (const name of e.names) {
          const list = fn.decls.get(name) ?? [];
          list.push({ line: n + 1, path: p });
          fn.decls.set(name, list);
        }
      } else if (e.kw === 'if' || e.kw === 'case') fn.stack.push({ kind: e.kw, id: ++fn.ids, branch: 0 });
      else if (e.kw === 'do') fn.stack.push({ kind: 'do', id: ++fn.ids, branch: 1 });
      else if ((e.kw === 'then' || e.kw === 'elif' || e.kw === 'else') && top?.kind === 'if') top.branch++;
      else if ((e.kw === 'fi' && top?.kind === 'if') || (e.kw === 'esac' && top?.kind === 'case') || (e.kw === 'done' && top?.kind === 'do')) fn.stack.pop();
    }
  }
  return found.map(({ line, name, declaredAt }) => ({ line, name, declaredAt }));
}

/** The `$( ... )` bodies on `line`, matched by paren depth. */
function substitutions(line) {
  const out = [];
  for (let at = line.indexOf('$('); at >= 0; at = line.indexOf('$(', at + 2)) {
    if (line[at + 2] === '(') continue; // $(( arithmetic ))
    let depth = 0;
    for (let i = at + 1; i < line.length; i++) {
      if (line[i] === '(') depth++;
      else if (line[i] === ')' && --depth === 0) { out.push(line.slice(at + 2, i)); break; }
    }
  }
  return out;
}

const ASSIGN = /^\s*(?:export\s+|readonly\s+)?[A-Za-z_][A-Za-z0-9_]*=/;
const TEST_AND = /^\s*(?:\[\[?|test)\s.*&&/;

/**
 * Second shape (review 2026-11-23 F2): under `set -e`, a plain assignment whose `$( ... )` is a test chained with `&&`
 * and no `||` takes the test's failure as its own status, so the script exits there with no message. `local` masks the
 * status and is not reported. Findings: [{ line }].
 */
function scanErrexit(text) {
  if (!/^\s*set\s+-[a-zA-Z]*e|^\s*set\s+-o\s+errexit/m.test(text)) return [];
  return text.split('\n').flatMap((raw, n) => (ASSIGN.test(raw) && substitutions(raw).some((s) => TEST_AND.test(s) && !s.includes('||')) ? [{ line: n + 1 }] : []));
}

/** Shell scripts under the given paths (a .sh file, or a file whose first line is a bash or sh shebang). */
function scripts(paths) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p).sort()) if (!SKIP_DIRS.has(e)) walk(path.join(p, e));
      return;
    }
    if (!st.isFile() || st.size > 1024 * 1024) return;
    if (p.endsWith('.sh')) { out.push(p); return; }
    if (path.extname(p) === '') {
      const head = fs.readFileSync(p, 'utf8').slice(0, 64);
      if (/^#!.*\b(ba)?sh\b/.test(head)) out.push(p);
    }
  };
  for (const p of paths) if (fs.existsSync(p)) walk(p);
  return out;
}

function main(argv) {
  const targets = argv.length ? argv : [path.join(ROOT, 'bench'), path.join(ROOT, 'scripts')];
  let n = 0;
  for (const file of scripts(targets)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const f of scan(text)) {
      n++;
      console.log(`${path.relative(process.cwd(), file)}:${f.line}: ${f.name} is read here but declared local only inside a branch (line ${f.declaredAt.join(', ')}); bind it at the top of the function`);
    }
    for (const f of scanErrexit(text)) {
      n++;
      console.log(`${path.relative(process.cwd(), file)}:${f.line}: under set -e this assignment exits when the test in its $( ) fails; add || true`);
    }
  }
  if (!n) console.log('ok: no branch-only local read after its branch, no set -e assignment ending on a failed test');
  return n ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { scan, scanErrexit, scripts };
