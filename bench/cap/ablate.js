// SPDX-License-Identifier: Apache-2.0
'use strict';

// Candidate sections and variant texts for one skill. A variant either removes a section or moves it to
// references/<id>.md behind an "open when" line, the layout the slimmed skills already use. Pure text in, text out.

const { slugOf, estTokens, parseSkill } = require('./sections.js');

const MIN_BYTES = 800;
const SPLIT_BYTES = 6000;
const MAX_CANDIDATES = 4;

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * Sections worth testing: level 2 and up (never the title and opening lines), over `minBytes`. A section over
 * `splitBytes` also offers its level-3 children. The `max` largest are kept and returned in document order.
 */
function candidateSections(parsed, { minBytes = MIN_BYTES, splitBytes = SPLIT_BYTES, max = MAX_CANDIDATES } = {}) {
  const out = [];
  for (const s of parsed.sections) {
    if (s.level < 2 || s.bytes < minBytes) continue;
    if (s.level === 2) { out.push(s); continue; }
    const parent = parsed.sections.find((p) => p.id === s.parent);
    if (parent && parent.level === 2 && parent.bytes >= splitBytes) out.push(s);
  }
  const keep = [...out].sort((a, b) => b.bytes - a.bytes || a.startLine - b.startLine).slice(0, max);
  return keep.sort((a, b) => a.startLine - b.startLine);
}

const linesOf = (text) => {
  const l = String(text).replace(/\r\n/g, '\n').split('\n');
  if (l.at(-1) === '') l.pop();
  return l;
};
const join = (lines) => `${lines.join('\n')}\n`;

/** The text with the section's lines (heading to end, children included) deleted. */
function removeSection(text, sec) {
  const lines = linesOf(text);
  const out = [...lines.slice(0, sec.startLine - 1), ...lines.slice(sec.endLine)];
  const at = sec.startLine - 1;
  if (at > 0 && at < out.length && out[at - 1] === '' && out[at] === '') out.splice(at, 1);
  while (out.length && out.at(-1) === '') out.pop();
  return join(out);
}

const defaultOpenWhen = (sec) => (sec.kind === 'reference' ? `you need the ${lowerFirst(sec.title)} (templates, tables or examples)` : `you need the detailed ${lowerFirst(sec.title)} guidance`);

/**
 * The section body goes to references/<id>.md and the heading stays with two lines: what the file holds and when to open it.
 * Returns { text, refPath, refText }.
 */
const refPathOf = (sec) => `references/${slugOf(sec.id)}.md`;
const pointerFor = (heading, sec, when) => [heading, '', `\`${refPathOf(sec)}\` holds the full text of this section.`, '', `Read \`${refPathOf(sec)}\` (relative to this file) when ${when}.`];

/** Bytes the heading and the two pointer lines take in SKILL.md once the section body has moved out. */
function pointerBytes(sec, { openWhen } = {}) {
  const heading = `${'#'.repeat(sec.level ?? 2)} ${sec.title}`;
  return Buffer.byteLength(`${pointerFor(heading, { id: sec.id ?? slugOf(sec.title) }, openWhen || defaultOpenWhen(sec)).join('\n')}\n`);
}

function moveSection(text, sec, { openWhen } = {}) {
  const lines = linesOf(text);
  const refPath = refPathOf(sec);
  const when = openWhen || defaultOpenWhen(sec);
  const pointer = pointerFor(lines[sec.startLine - 1], sec, when);
  const body = lines.slice(sec.startLine, sec.endLine);
  while (body.length && body[0] === '') body.shift();
  while (body.length && body.at(-1) === '') body.pop();
  const rest = lines.slice(sec.endLine);
  const out = [...lines.slice(0, sec.startLine - 1), ...pointer, ...(rest.length ? [''] : []), ...rest];
  const refText = join([`# ${sec.title}`, '', ...body]);
  return { text: join(out), refPath, refText };
}

/**
 * Every variant for one skill: ctl (the skill as it is), del (the skill removed), then rm<k> and mv<k> for the k-th
 * candidate in document order. Section variants carry the new SKILL.md text, the file range, bytes and tokens saved,
 * and for a move the reference file.
 */
function buildVariants({ name, text, candidates, openWhen = {} }) {
  const full = Buffer.byteLength(text);
  const out = [{ id: 'ctl', kind: 'control', skill: name, text }, { id: 'del', kind: 'delete', skill: name }];
  const section = (sec) => ({ id: sec.id, title: sec.title, level: sec.level, kind: sec.kind, bytes: sec.bytes, estTokens: sec.estTokens });
  const range = (sec) => ({ startLine: sec.startLine, endLine: sec.endLine });
  candidates.forEach((sec, i) => {
    const t = removeSection(text, sec);
    const saved = full - Buffer.byteLength(t);
    out.push({ id: `rm${i + 1}`, kind: 'remove', skill: name, section: section(sec), range: range(sec), text: t, bytesSaved: saved, tokensSaved: estTokens(saved) });
  });
  candidates.forEach((sec, i) => {
    const m = moveSection(text, sec, { openWhen: openWhen[sec.id] });
    const saved = full - Buffer.byteLength(m.text);
    out.push({ id: `mv${i + 1}`, kind: 'move', skill: name, section: section(sec), range: range(sec), text: m.text, files: { [m.refPath]: m.refText }, bytesSaved: saved, tokensSaved: estTokens(saved) });
  });
  return out;
}

/**
 * Applies several decided cuts to one text. edits: [{ section: { startLine, endLine, id, title, level, kind }, action: 'remove'|'move', openWhen }].
 * Cuts run from the bottom up so earlier line numbers stay valid, and a cut inside another cut's range is dropped.
 * Returns { text, files } where files maps references/<id>.md to its text.
 */
function applyCuts(text, edits) {
  const inside = (a, b) => a !== b && a.section.startLine >= b.section.startLine && a.section.endLine <= b.section.endLine;
  const live = edits.filter((e) => !edits.some((o) => inside(e, o)));
  let out = text;
  const files = {};
  for (const e of [...live].sort((a, b) => b.section.startLine - a.section.startLine)) {
    if (e.action === 'remove') out = removeSection(out, e.section);
    else if (e.action === 'move') {
      const m = moveSection(out, e.section, { openWhen: e.openWhen });
      out = m.text;
      files[m.refPath] = m.refText;
    }
  }
  return { text: out, files };
}

/** Parse, pick candidates and build variants in one call. */
function ablationFor({ name, text, minBytes, splitBytes, max, openWhen }) {
  const parsed = parseSkill(text);
  const candidates = candidateSections(parsed, { minBytes, splitBytes, max });
  return { parsed, candidates, variants: buildVariants({ name, text, candidates, openWhen }) };
}

module.exports = { applyCuts, candidateSections, removeSection, moveSection, pointerBytes, defaultOpenWhen, buildVariants, ablationFor, MIN_BYTES, SPLIT_BYTES, MAX_CANDIDATES };
