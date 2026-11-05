// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the agent changed: a line diff per file, comment detection and the diff text a judge is shown.

const { redact } = require('../redact.js');

const MAX_DIFF_CHARS = 12000;

/**
 * Line-level diff of two texts: [{op: ' ' | '+' | '-', text}]. A common prefix and suffix are trimmed first, then an LCS
 * over the middle; beyond 4 million cells the middle is reported as removed and added whole.
 */
function lineDiff(oldText, newText) {
  const a = oldText === null || oldText === undefined ? [] : String(oldText).split('\n');
  const b = String(newText).split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const midA = a.slice(s, ea);
  const midB = b.slice(s, eb);
  const ops = a.slice(0, s).map((text) => ({ op: ' ', text }));
  if (midA.length * midB.length > 4e6) {
    for (const text of midA) ops.push({ op: '-', text });
    for (const text of midB) ops.push({ op: '+', text });
  } else {
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ op: ' ', text: midA[i] }); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ op: '-', text: midA[i] }); i++; }
      else { ops.push({ op: '+', text: midB[j] }); j++; }
    }
    for (; i < n; i++) ops.push({ op: '-', text: midA[i] });
    for (; j < m; j++) ops.push({ op: '+', text: midB[j] });
  }
  for (let k = ea; k < a.length; k++) ops.push({ op: ' ', text: a[k] });
  return ops;
}

const COMMENT_LINE = /^\s*(\/\/|#(?!!)|\/\*|\*\s|\*\/|--\s|"""|''')/;
const isCommentLine = (line) => COMMENT_LINE.test(line);

/** What the agent changed in each file: added and removed line counts, added code lines and added comment lines. */
function changeStats(files) {
  return files.filter((f) => !f.binary).map((f) => {
    const ops = lineDiff(f.orig, f.text);
    const added = ops.filter((o) => o.op === '+').map((o) => o.text);
    return { rel: f.rel, created: f.created, ops, added: added.length, removed: ops.filter((o) => o.op === '-').length, addedComments: added.filter(isCommentLine).length, addedCode: added.filter((l) => l.trim() && !isCommentLine(l)).length };
  });
}

/** The agent's changes as unified-style hunks (2 lines of context), capped at maxChars. Created files list every line as added. */
function diffText(stats, { maxChars = MAX_DIFF_CHARS } = {}) {
  const parts = [];
  for (const f of stats) {
    const keep = new Array(f.ops.length).fill(false);
    f.ops.forEach((o, i) => { if (o.op !== ' ') for (let k = Math.max(0, i - 2); k <= Math.min(f.ops.length - 1, i + 2); k++) keep[k] = true; });
    const lines = [];
    let gap = false;
    f.ops.forEach((o, i) => {
      if (keep[i]) { if (gap) lines.push('...'); lines.push(`${o.op}${o.text}`); gap = false; } else gap = true;
    });
    parts.push(`--- ${f.rel} (${f.created ? 'created' : 'modified'}: +${f.added} -${f.removed})\n${lines.join('\n')}`);
  }
  const text = parts.join('\n\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[diff truncated at ${maxChars} chars]` : text;
}

/** The text a judge sees, with the same redaction as the bundle so a diff cannot name the arm. */
function redactedChanges(stats, redactions) {
  return redact(diffText(stats), redactions).text;
}

module.exports = { MAX_DIFF_CHARS, lineDiff, changeStats, diffText, redactedChanges, isCommentLine };
