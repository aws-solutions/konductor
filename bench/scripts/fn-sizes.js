#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Function sizes in the bench's own JavaScript (DEBT FW-25): every named function, method and arrow or function
// expression bound to a name, with its line count from the head to its closing brace. A nested function is measured
// on its own and is also part of its parent's count.
//   node bench/scripts/fn-sizes.js [--over N] [FILE|DIR ...]   (default: every non-test bench .js, --over 150)
// shortcut: a small tokenizer, not a JS parser (no dependency is installed). It skips strings, template literals,
// comments and regex literals by the usual "a slash after an operator starts a regex" rule; a regex after `)` (as in
// `if (x) /re/.test(s)`) would be read as division. Upgrade to a real parser if one is ever added to the bench.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..');
// Agent-facing task content (fixtures, hidden tests, references), vendored files and tests are not bench code.
const SKIP_DIR = new Set(['node_modules', 'test', 'tests', 'fixtures', 'hidden', 'solutions', 'answers', 'authoring', 'pristine-tests', 'site-src', 'checklist-src', 'history']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'do', 'else', 'typeof', 'new', 'await', 'yield']);

/** Every non-test .js file under `dir`, sorted, as paths relative to the bench dir. */
function benchFiles(dir = BENCH) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) walk(p); }
      else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(path.relative(BENCH, p));
    }
  };
  walk(dir);
  return out;
}

/**
 * The code of `text` with strings, templates, comments and regex literals blanked to spaces (newlines kept), so
 * braces and names can be read by position. Template `${...}` bodies stay code.
 */
function blank(text) {
  const out = text.split('');
  const n = text.length;
  const stack = []; // open template literals, each with the brace depth its ${ started at
  let depth = 0;
  let prev = ''; // last significant code character, for the regex rule
  const wipe = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  const template = () => { // i is just after a backtick or a closing } of ${...}; scan to ` or ${
    const s = i;
    while (i < n && text[i] !== '`' && !(text[i] === '$' && text[i + 1] === '{')) i += text[i] === '\\' ? 2 : 1;
    wipe(s, i);
    if (text[i] === '`') { i++; prev = 'x'; return; }
    stack.push(depth); depth++; i += 2; prev = '{';
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { const s = i; while (i < n && text[i] !== '\n') i++; wipe(s, i); continue; }
    if (c === '/' && text[i + 1] === '*') { const s = i; i = text.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; wipe(s, i); continue; }
    if (c === '"' || c === "'") { const s = i++; while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1; i++; wipe(s + 1, i - 1); prev = 'x'; continue; }
    if (c === '`') { i++; template(); continue; }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      const s = i++; let cls = false;
      while (i < n && text[i] !== '\n' && (cls || text[i] !== '/')) { if (text[i] === '\\') i++; else if (text[i] === '[') cls = true; else if (text[i] === ']') cls = false; i++; }
      i++; while (/[a-z]/i.test(text[i] || '')) i++;
      wipe(s + 1, i - 1); prev = 'x'; continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (stack.length && stack[stack.length - 1] === depth) { stack.pop(); i++; template(); continue; }
    }
    if (!/\s/.test(c)) prev = /[\w$)\]]/.test(c) ? (c === ')' || c === ']' ? ')' : 'x') : c;
    i++;
  }
  return out.join('');
}

/** [{ name, line, lines }] for each function in `text` (1-based start line, line count head to closing brace). */
function functionSizes(text) {
  const code = blank(text);
  const lineAt = []; // offset -> line, built lazily
  let ln = 1;
  for (let k = 0; k < code.length; k++) { lineAt[k] = ln; if (code[k] === '\n') ln++; }
  const heads = [];
  const add = (name, at, from) => heads.push({ name, at, from });
  let m;
  const fnRe = /\bfunction\b\s*\*?\s*([\w$]*)\s*\(/g;
  while ((m = fnRe.exec(code))) add(m[1] || '(anonymous)', m.index, m.index + m[0].length);
  const bindRe = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[\w$]+)\s*=>\s*\{/g;
  while ((m = bindRe.exec(code))) add(m[1], m.index, m.index + m[0].length - 1);
  const methodRe = /^[ \t]*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([\w$]+)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\{/gm;
  while ((m = methodRe.exec(code))) if (!KEYWORDS.has(m[1])) add(m[1], m.index + m[0].indexOf(m[1]), m.index + m[0].length - 1);
  const keyRe = /\b([\w$]+)\s*:\s*(?:async\s+)?(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[\w$]+)\s*=>\s*\{/g;
  while ((m = keyRe.exec(code))) add(m[1], m.index, m.index + m[0].length - 1);
  const seen = new Set();
  const out = [];
  for (const h of heads.sort((a, b) => a.at - b.at)) {
    let from = h.from;
    if (code[from - 1] === '(') { // a `function` head: skip its parameter list, which may hold { destructuring }
      let p = 1;
      while (from < code.length && p > 0) { if (code[from] === '(') p++; else if (code[from] === ')') p--; from++; }
    }
    const open = code.indexOf('{', from);
    if (open < 0 || seen.has(open)) continue;
    seen.add(open);
    let d = 0; let k = open;
    for (; k < code.length; k++) { if (code[k] === '{') d++; else if (code[k] === '}' && --d === 0) break; }
    if (k >= code.length) continue;
    out.push({ name: h.name, line: lineAt[h.at], lines: lineAt[k] - lineAt[h.at] + 1 });
  }
  return out;
}

/** [{ file, name, line, lines }] over `files` (bench-relative), the functions longer than `over` lines. */
function over(files, limit) {
  const out = [];
  for (const f of files) {
    for (const s of functionSizes(fs.readFileSync(path.join(BENCH, f), 'utf8'))) if (s.lines > limit) out.push({ file: f, ...s });
  }
  return out.sort((a, b) => b.lines - a.lines);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--over');
  const limit = i >= 0 ? Number(args.splice(i, 2)[1]) : 150;
  const files = args.length ? args.flatMap((a) => (fs.statSync(a).isDirectory() ? benchFiles(path.resolve(a)) : [path.relative(BENCH, path.resolve(a))])) : benchFiles();
  for (const r of over(files, limit)) console.log(`${r.lines}\t${r.file}:${r.line}\t${r.name}`);
}

module.exports = { functionSizes, benchFiles, over, blank };
