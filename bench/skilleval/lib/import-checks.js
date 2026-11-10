// SPDX-License-Identifier: Apache-2.0
'use strict';

// Turns the shell checks of the skill-evals data (floor_checks, scripted_checks) into bench task checks. A check the
// task schema cannot express, or that needs a tool the runner does not promise, comes back as unsupported and the caller
// makes a rubric item of its text.

const SAFE_COMMANDS = new Set([
  'test', '[', '[[', 'grep', 'egrep', 'fgrep', 'awk', 'sed', 'sort', 'uniq', 'wc', 'head', 'tail', 'cat', 'ls', 'find', 'echo', 'printf',
  'tr', 'cut', 'basename', 'dirname', 'diff', 'cmp', 'expr', 'node', 'sh', 'true', 'false', 'exit', 'read',
]);
const LEADING_KEYWORDS = new Set(['!', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', 'time']);
const SKIPPED_WORDS = new Set(['done', 'fi', 'esac']);
const HEADER_WORDS = new Set(['for', 'case', 'select']);
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const GREP_FLAGS = /^-[qiE]+$/;
// The task validator rejects a verdict pattern that matches a plain list of verdict words (tasks/validate-tasks.js).
const VERDICT_PATTERN = /verdict|needs fixes|not ready|ready for (cr|release)/i;
const VERDICT_LISTING = 'Possible verdicts: READY FOR CR, NEEDS FIXES, NOT READY, READY FOR RELEASE, PASS, FAIL.\nThe verdict is one of PASS or FAIL.\nVerdict options: NEEDS FIXES or READY FOR CR.\n';
const listsVerdicts = (c) => c.type === 'contains' && VERDICT_PATTERN.test(c.pattern) && new RegExp(c.pattern, 'im').test(VERDICT_LISTING);

/** Splits on spaces, tabs and quote-aware shell operators. `ops` is true when any operator or expansion is present. */
function tokenize(cmd) {
  const words = [];
  let cur = '';
  let has = false;
  let ops = false;
  let q = null;
  const push = () => { if (has) words.push(cur); cur = ''; has = false; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && /["\\$`]/.test(cmd[i + 1] ?? '')) { cur += cmd[++i]; }
      else { if (c === '$' || c === '`') ops = true; cur += c; }
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\') { cur += cmd[++i] ?? ''; has = true; continue; }
    if (/\s/.test(c)) { if (c === '\n') ops = true; push(); continue; }
    if ('|&;()<>`$'.includes(c) || c === '{' || c === '}') ops = true;
    cur += c;
    has = true;
  }
  if (q) ops = true;
  push();
  return { words, ops };
}

/** Quote-aware split on the given operator characters; returns the segments (each trimmed, empties dropped). */
function splitOutside(cmd, seps) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"') cur += cmd[++i] ?? ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\') { cur += c + (cmd[++i] ?? ''); continue; }
    if (seps.includes(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The command word of every segment of the line, or null when the line cannot be read. */
function commandWords(cmd) {
  const words = [];
  for (const seg of splitOutside(cmd, '|&;()`\n{}')) {
    let w = tokenize(seg).words;
    while (w.length && (LEADING_KEYWORDS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w = w.slice(1);
    if (!w.length || SKIPPED_WORDS.has(w[0]) || /^(-|\d+$|\])/.test(w[0])) continue;
    if (HEADER_WORDS.has(w[0])) continue;
    if (w[0].startsWith('$')) return null;
    words.push(w[0].split('/').pop());
  }
  return words;
}

// A grep -E pattern reads the same in JavaScript, a plain grep pattern only when it has no operator that differs.
function patternOk(pattern, extended) {
  if (!pattern || /\[:|\[\.|\[=/.test(pattern)) return false;
  if (extended) return !/\\[<>`'AZzB]|\(\?/.test(pattern);
  return !/[\\+?|(){}]/.test(pattern);
}

/** One simple command as a bench check, or null. */
function simpleCheck(part) {
  const { words, ops } = tokenize(part);
  if (ops || !words.length) return null;
  let w = words;
  const neg = w[0] === '!';
  if (neg) w = w.slice(1);
  if (w[0] === 'test' && !neg && w.length === 3 && (w[1] === '-f' || w[1] === '-e') && PATH_RE.test(w[2]) && !w[2].includes('..')) {
    return { type: 'file_exists', path: w[2] };
  }
  if (w[0] !== 'grep') return null;
  let i = 1;
  let letters = '';
  while (i < w.length && w[i].startsWith('-') && w[i] !== '-') {
    if (!GREP_FLAGS.test(w[i])) return null;
    letters += w[i].slice(1);
    i++;
  }
  if (!letters.includes('q') || w.length - i !== 2) return null;
  const [pattern, file] = [w[i], w[i + 1]];
  if (!PATH_RE.test(file) || file.includes('..') || !patternOk(pattern, letters.includes('E'))) return null;
  try { new RegExp(pattern, 'im'); } catch { return null; }
  return { type: neg ? 'not_contains' : 'contains', path: file, pattern };
}

/**
 * { checks } for a command the schema can express, else { unsupported: reason }. A chain of simple commands joined by && becomes
 * one check each. Any other line stays a `cmd` check when every command in it is a POSIX tool or node; otherwise it is unsupported.
 */
function convertCheck(cmd) {
  const text = String(cmd ?? '').trim();
  if (!text) return { unsupported: 'empty command' };
  const parts = text.includes('&&') ? splitOutside(text, '&') : [text];
  const simple = parts.map(simpleCheck);
  if (simple.every(Boolean)) {
    return simple.some(listsVerdicts) ? { unsupported: 'matches a bare list of verdict words' } : { checks: simple };
  }
  const words = commandWords(text);
  if (!words) return { unsupported: 'runs a command held in a variable' };
  const bad = [...new Set(words.filter((x) => !SAFE_COMMANDS.has(x)))];
  if (bad.length) return { unsupported: `uses ${bad.join(', ')}` };
  return { checks: [{ type: 'cmd', cmd: text, expectExit: 0 }] };
}

module.exports = { convertCheck, commandWords, simpleCheck, tokenize, splitOutside, SAFE_COMMANDS };
