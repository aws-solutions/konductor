// SPDX-License-Identifier: Apache-2.0
'use strict';

// The copy the read judge view hands a judge, and the prompt text that goes with it. The copy is built from the
// bundle's own file texts (credential-scrubbed and redacted the way the bundle is), never copied from the run folder,
// so it holds no symlink, no answer key, no hidden test, no check result and no fixture file. A file the judge must
// not read from a folder is pasted into the prompt instead:
//   - an instruction file (AGENTS.md, CLAUDE.md, CONTEXT.md at any depth): opencode attaches such a file as
//     instructions when the judge reads anything below it, and no flag turns that off;
//   - a file under a tool folder (.opencode, .kiro, .claude, .git, .konductor);
//   - a file with a line over 2,000 characters: opencode's read cuts such a line with no way to get the rest;
//   - a file whose path the redactions change (its name would tell the arm).
// writeCopy and instructionFilesAbove are also used by the backend that writes the copy (through the SDK).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildBundle } = require('../bundle.js');
const { redact } = require('../redact.js');
const { scrubStringCounted, secretLiterals } = require('../../runner/lib/scrub.js');

const MAX_LINE_CHARS = 2000;
const INSTRUCTION_NAMES = Object.freeze(['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']);
const TOOL_DIRS = Object.freeze(['.opencode', '.kiro', '.claude', '.git', '.konductor']);

const lower = (xs) => xs.map((x) => x.toLowerCase());
const isInstruction = (name) => lower(INSTRUCTION_NAMES).includes(name.toLowerCase());
const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** Why the copy may not hold `rel` as a file (an unsafe path, an instruction file, a tool folder), or null. */
function pathRefusal(rel) {
  const parts = String(rel).split('/');
  if (!rel || path.isAbsolute(rel) || parts.some((p) => p === '' || p === '.' || p === '..')) return 'not a plain relative path';
  if (isInstruction(parts[parts.length - 1])) return 'instruction file';
  if (parts.slice(0, -1).some((p) => lower(TOOL_DIRS).includes(p.toLowerCase()))) return 'tool folder';
  return null;
}

/** Why a text file must be pasted instead of copied, or null when the judge reads it from the copy. */
function pasteReason(rel, text, redactions) {
  const refused = pathRefusal(rel);
  if (refused) return refused;
  if (text.split('\n').some((l) => l.length > MAX_LINE_CHARS)) return `a line over ${MAX_LINE_CHARS} characters`;
  if (redact(rel, redactions).text !== rel) return 'name changed by redaction';
  return null;
}

/**
 * The read view's input for one run: `bundle` (today's bundle, for quote matching and the record), `promptText` (the
 * bundle with each copied file shown as a pointer), `preface` (the file list and the read-in-full rule), `copy`
 * ({ files: [{ rel, text, lines, bytes }], sha }) and `pasted` ([{ rel, reason }]).
 */
function buildReadInput({ runDir, result, fixtureDir, limits, redactions, literals = secretLiterals(process.env) }) {
  const bundle = buildBundle({ runDir, result, fixtureDir, limits, redactions, literals });
  const files = [];
  const pasted = [];
  for (const f of bundle.files.filter((x) => !x.binary)) {
    const text = scrubStringCounted(redact(f.text, redactions).text, literals).text;
    const reason = pasteReason(f.rel, text, redactions);
    if (reason) pasted.push({ rel: f.rel, reason });
    else files.push({ rel: f.rel, text, lines: lineCount(text), bytes: Buffer.byteLength(text) });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  pasted.sort((a, b) => a.rel.localeCompare(b.rel));
  const copied = new Set(files.map((f) => f.rel));
  const promptText = buildBundle({ runDir, result, fixtureDir, limits, redactions, literals, readable: (rel) => copied.has(rel) }).text;
  const sha = crypto.createHash('sha256').update(JSON.stringify(files.map((f) => [f.rel, f.text]))).digest('hex');
  return { bundle, promptText, preface: prefaceOf(files), copy: { files, sha }, pasted };
}

function prefaceOf(files) {
  const list = files.map((f) => `- ${f.rel} (${f.lines} line${f.lines === 1 ? '' : 's'}, ${f.bytes} bytes)`).join('\n');
  return `FILES IN YOUR WORKING FOLDER (${files.length}):\n${list || '(none)'}\n`
    + 'These files are part of the output: the files created or changed that the output below shows only by name. '
    + 'Read every file listed here in full with the read tool before you grade, using offset to continue a long file. '
    + 'A judgment that has not read every line of every listed file is not scored. Use only the read, glob and grep tools, '
    + 'only inside your working folder. Quote evidence from these files or from the output exactly as written.';
}

/** Writes `files` ([{ rel, text }]) as new plain files under `dir`. Throws on a refused path or a file that exists. */
function writeCopy(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const why = pathRefusal(f.rel);
    if (why) throw new Error(`read view copy: "${f.rel}" refused (${why})`);
    const file = path.join(dir, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, f.text, { flag: 'wx' });
  }
}

/** The instruction files (AGENTS.md, CLAUDE.md, CONTEXT.md) in any folder above `dir`, up to the filesystem root. */
function instructionFilesAbove(dir) {
  const found = [];
  for (let d = path.dirname(path.resolve(dir)); ; d = path.dirname(d)) {
    for (const n of INSTRUCTION_NAMES) if (fs.existsSync(path.join(d, n))) found.push(path.join(d, n));
    if (path.dirname(d) === d) break;
  }
  return found;
}

module.exports = { buildReadInput, writeCopy, instructionFilesAbove, pathRefusal, MAX_LINE_CHARS, INSTRUCTION_NAMES, TOOL_DIRS };
