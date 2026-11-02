// SPDX-License-Identifier: Apache-2.0
'use strict';

// Splits a SKILL.md into sections for the per-skill ablation study. Lines are 1-based and ranges are inclusive, so a
// range can be quoted as file:start-end and handed to a diff. Pure text; nothing is read from disk here.

const REFERENCE_TITLE = /\b(examples?|templates?|schemas?|references?|appendix|samples?|checklists?|catalog(ue)?|cheat ?sheet|glossary|output format|report format|patterns?)\b/i;
const REFERENCE_SHARE = 0.5;

const estTokens = (bytes) => Math.round(bytes / 4);
const bytesOf = (lines) => Buffer.byteLength(`${lines.join('\n')}\n`);

/** A short, stable id for a heading. */
function slugOf(title) {
  const s = String(title).toLowerCase().replace(/[`*_~]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return s || 'section';
}

function frontmatterRange(lines) {
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---') return { startLine: 1, endLine: i + 1 };
  return null;
}

// Fence state machine: a fence opens with 3+ backticks or tildes and closes on the same character, at least as long.
function scanFences(lines, from) {
  const fenced = new Array(lines.length).fill(false);
  const blocks = [];
  let open = null;
  for (let i = from; i < lines.length; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)/.exec(lines[i]);
    if (open) {
      fenced[i] = true;
      if (m && m[1][0] === open.ch && m[1].length >= open.len && !m[2]) { blocks.push({ startLine: open.line + 1, endLine: i + 1, lang: open.lang }); open = null; }
    } else if (m) {
      open = { ch: m[1][0], len: m[1].length, line: i, lang: m[2] || '' };
      fenced[i] = true;
    }
  }
  if (open) blocks.push({ startLine: open.line + 1, endLine: lines.length, lang: open.lang });
  return { fenced, blocks };
}

function tablesIn(lines, fenced, start, end) {
  const out = [];
  let i = start;
  while (i < end) {
    const isRow = (n) => !fenced[n] && /^\s*\|.*\|\s*$/.test(lines[n]);
    if (isRow(i) && i + 1 < end && isRow(i + 1) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      let j = i + 2;
      while (j < end && isRow(j)) j++;
      out.push({ startLine: i + 1, endLine: j });
      i = j;
    } else i++;
  }
  return out;
}

/**
 * { lineCount, bytes, frontmatter, preamble, sections }. A section runs from its heading to the line before the next
 * heading of the same or a higher level, so it includes its children. `preamble` is the text before the first level-2
 * heading (the title and the opening lines): the part ablation leaves alone.
 */
function parseSkill(text) {
  const raw = String(text).replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const fm = frontmatterRange(lines);
  const bodyFrom = fm ? fm.endLine : 0;
  const { fenced, blocks: fences } = scanFences(lines, bodyFrom);

  const heads = [];
  for (let i = bodyFrom; i < lines.length; i++) {
    if (fenced[i]) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) heads.push({ line: i + 1, level: m[1].length, title: m[2].trim() });
  }

  const used = new Map();
  const sections = heads.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].line - 1; break; }
    const base = slugOf(h.title);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const slice = lines.slice(h.line - 1, end);
    const code = fences.filter((f) => f.startLine > h.line && f.endLine <= end);
    const tables = tablesIn(lines, fenced, h.line - 1, end);
    const structured = code.reduce((a, f) => a + bytesOf(lines.slice(f.startLine - 2, f.endLine)), 0) + tables.reduce((a, t) => a + bytesOf(lines.slice(t.startLine - 1, t.endLine)), 0);
    const bytes = bytesOf(slice);
    const kind = REFERENCE_TITLE.test(h.title) || structured / bytes >= REFERENCE_SHARE ? 'reference' : 'procedure';
    return {
      id: n === 1 ? base : `${base}-${n}`, title: h.title, level: h.level, startLine: h.line, endLine: end, bodyStartLine: h.line + 1,
      lines: slice.length, bytes, estTokens: estTokens(bytes), blocks: { code, tables }, kind, parent: null, children: [],
    };
  });
  // The parent is the nearest earlier section of a lower level whose range still covers this one.
  sections.forEach((s, i) => {
    for (let j = i - 1; j >= 0; j--) if (sections[j].level < s.level && sections[j].endLine >= s.endLine) { s.parent = sections[j].id; sections[j].children.push(s.id); break; }
  });

  const firstH2 = sections.find((s) => s.level >= 2);
  const preEnd = firstH2 ? firstH2.startLine - 1 : lines.length;
  const preStart = fm ? fm.endLine + 1 : 1;
  return {
    lineCount: lines.length, bytes: bytesOf(lines), frontmatter: fm,
    preamble: { startLine: preStart, endLine: Math.max(preStart, preEnd), bytes: bytesOf(lines.slice(preStart - 1, Math.max(preStart, preEnd))) },
    sections,
  };
}

module.exports = { parseSkill, slugOf, estTokens, REFERENCE_TITLE };
