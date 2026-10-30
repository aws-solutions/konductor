// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads the YAML frontmatter of a SKILL.md for the fields the bench needs (name, description, tags).
// Only top-level `key: value` lines are understood, plus folded (>) and literal (|) block scalars.

const frontmatter = (text) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';

const BLOCK = /^([>|])([+-]?)\s*$/;

function lineOf(fm, key) {
  const lines = fm.split('\n');
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) return { lines, index: i, rest: m[1].trim() };
  }
  return null;
}

// Lines of a block scalar: every following line that is indented or blank, until the next top-level key.
function blockLines(lines, from) {
  const body = [];
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i].trim() === '' || /^\s/.test(lines[i])) body.push(lines[i]);
    else break;
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  const indent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)[0].length));
  return Number.isFinite(indent) ? body.map((l) => l.slice(indent)) : [];
}

function foldLines(body) {
  let out = '';
  for (const l of body) {
    if (l.trim() === '') { out += '\n'; continue; }
    if (out && !out.endsWith('\n')) out += ' ';
    out += l.trim();
  }
  return out;
}

/**
 * The value of a top-level key with its YAML style: plain, quoted, folded, literal, empty or missing.
 * A plain or quoted value is the rest of its line, trimmed, with any quotes left in place.
 */
function fmInfo(fm, key) {
  const hit = lineOf(fm, key);
  if (!hit) return { value: '', style: 'missing', present: false };
  const block = BLOCK.exec(hit.rest);
  if (block) {
    const body = blockLines(hit.lines, hit.index);
    return { value: block[1] === '>' ? foldLines(body) : body.join('\n'), style: block[1] === '>' ? 'folded' : 'literal', present: true };
  }
  if (hit.rest === '') return { value: '', style: 'empty', present: true };
  return { value: hit.rest, style: /^["']/.test(hit.rest) ? 'quoted' : 'plain', present: true };
}

const fmValue = (fm, key) => fmInfo(fm, key).value;

module.exports = { frontmatter, fmValue, fmInfo };
