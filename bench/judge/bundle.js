// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const { aggregateEvents } = require('../runner/lib/harness/opencode-parse.js');
const claudeParse = require('../runner/lib/harness/claude-code-parse.js');
const strandsParse = require('../plugins/strands/parse.js');
const { runtimeOf, descriptorOf } = require('../runner/lib/harness/runtime.js');
const { ANSWER_KEY } = require('../runner/lib/sandbox.js');
const { redact } = require('./redact.js');
const { scrubStringCounted, secretLiterals } = require('../runner/lib/scrub.js');
const { isEphemeralDir, isEphemeralFile } = require('./ephemeral.js');
const { toolSessions, toolBlock } = require('./toolcalls.js');

// Tool state, not deliverables; listing it would also reveal the arm. Deliverables such as
// .kiro/specs/** are kept. Names match at any depth, paths from the workspace root.
const SKIP_NAMES = new Set(['.git', 'node_modules']);
const SKIP_PATHS = ['.kiro/agents', '.kiro/steering', '.kiro/skills', '.kiro/settings', '.kiro/sessions', '.konductor', '.claude', '.opencode'];
const skipped = (rel) => SKIP_NAMES.has(path.basename(rel)) || SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));

// `excluded` counts skipped tool-state directories; `ephemeral` counts the test and lint caches skipped (see ephemeral.js),
// directories and stray compiled files together.
function walk(root, rel = '') {
  const out = [];
  const excluded = { count: 0, ephemeral: 0 };
  const visit = (r) => {
    for (const ent of fs.readdirSync(path.join(root, r), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const sub = path.join(r, ent.name);
      if (ent.isDirectory()) {
        if (skipped(sub)) excluded.count++;
        else if (isEphemeralDir(ent.name)) excluded.ephemeral++;
        else visit(sub);
      } else if (ent.isFile() && ent.name !== ANSWER_KEY) {
        if (isEphemeralFile(ent.name)) excluded.ephemeral++;
        else out.push(sub);
      }
    }
  };
  if (fs.existsSync(path.join(root, rel))) visit(rel);
  
  // Write git log to GIT-LOG.txt when .git exists at snapshot time
  const gitDir = path.join(root, rel, '.git');
  if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
    try {
      const { execSync } = require('node:child_process');
      const logPath = path.join(root, rel, 'GIT-LOG.txt');
      const log = execSync("git log --all --format='%h %s%n%b' --merges", { cwd: path.join(root, rel), encoding: 'utf8' });
      fs.writeFileSync(logPath, log);
      out.push(path.join(rel, 'GIT-LOG.txt').replace(/\\/g, '/'));
    } catch { /* git missing or the repo unreadable: the bundle goes without GIT-LOG.txt, as for a tree with no .git */ }
  }
  
  return { files: out, excluded: excluded.count, ephemeral: excluded.ephemeral };
}

function readText(file) {
  const buf = fs.readFileSync(file);
  if (!buf.includes(0)) return { text: buf.toString('utf8') };
  return { binary: true, size: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

// By stream format. kiro-acp: the runFinished event's text. opencode-json: the last assistant text event of the parent
// session. claude-stream-json: the last result line's text, else (also when that text is blank) the last assistant text
// of the main session.
const FINAL_TEXT = {
  'kiro-acp': (events) => aggregateStream(events).finalText,
  'opencode-json': (events) => aggregateEvents(events).lastText,
  'strands-jsonl': (events) => strandsParse.aggregateEvents(events).finalText,
  'claude-stream-json': (events) => {
    const a = claudeParse.aggregateEvents(events);
    const blank = (t) => typeof t !== 'string' || !t.trim();
    if (!blank(a.finalText)) return a.finalText;
    return blank(a.lastText) ? a.finalText ?? a.lastText : a.lastText;
  },
};

function finalTextOf(runDir, result = null) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return null;
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  return FINAL_TEXT[descriptorOf(runtimeOf(result)).streamFormat](events);
}

// Autonomy runs only: what the scripted user was asked and what it answered. Judged with the rest of the bundle, so redaction applies.
function conversationBlock(result) {
  if (!Array.isArray(result.questions) || typeof result.turns !== 'number') return null;
  if (!result.questions.length) return '## Conversation\nThe agent asked no question.';
  const lines = result.questions.map((q, i) => `Question ${i + 1} (after turn ${q.turn}): ${q.text}\n${q.answered ? `Reply: ${q.reply ?? ''}` : 'No reply was sent.'}`);
  return `## Conversation\n${lines.join('\n\n')}`;
}

// Builds the only view of a run that a judge sees. It is assembled from the
// final text, the files that differ from the fixture, and the tool calls of the main session and of any child session it started
// (see toolcalls.js); the transcript's messages and thoughts, and the check results, are never shown. Credential-shaped text, and the exact values in `literals`, is scrubbed from
// the text and the file texts last, so nothing the run output scrubber missed reaches a model. `literals` defaults to the
// credential values of this process's environment, the same set the run scrubber uses, so a caller cannot leave it out by
// accident. Callers that build the same bundle twice (judging, quote matching, rescoring) get the same text. meta.credsScrubbed
// counts the replacements.
function buildBundle({ runDir, result, fixtureDir, limits, redactions, literals = secretLiterals(process.env) }) {
  const { maxFileChars, maxBundleChars } = limits;
  const meta = { truncatedFiles: [], omittedFiles: [], excluded: 0, ephemeral: 0 };
  const ws = walk(path.join(runDir, 'workspace'));
  meta.excluded = ws.excluded;
  meta.ephemeral = ws.ephemeral;
  const base = new Set(walk(fixtureDir).files);

  const changed = [];
  for (const rel of ws.files) {
    const mine = readText(path.join(runDir, 'workspace', rel));
    const orig = base.has(rel) ? readText(path.join(fixtureDir, rel)) : null;
    const same = orig && !mine.binary && !orig.binary ? orig.text === mine.text : orig && mine.binary && orig.binary && orig.sha === mine.sha;
    if (!same) changed.push({ rel, created: !orig, orig: orig && !orig.binary ? orig.text : null, ...mine });
  }
  const deleted = [...base].filter((rel) => !ws.files.includes(rel)).sort();

  const parts = [];
  parts.push(`## Final assistant text\n${finalTextOf(runDir, result) ?? '(none)'}`);
  const conversation = conversationBlock(result);
  if (conversation) parts.push(conversation);
  const fileParts = [];
  let used = 0;
  for (const f of changed) {
    const head = `### ${f.rel} (${f.created ? 'created' : 'modified'})`;
    if (used >= maxBundleChars) {
      meta.omittedFiles.push(f.rel);
      continue;
    }
    if (f.binary) {
      fileParts.push(`${head}\n(binary file, ${f.size} bytes)`);
      continue;
    }
    const room = Math.min(maxFileChars, maxBundleChars - used);
    let body = f.text;
    let note = '';
    if (body.length > room) {
      body = body.slice(0, room);
      note = `\n[truncated at ${room} chars; file has ${f.text.length}]`;
      meta.truncatedFiles.push(f.rel);
    }
    used += body.length;
    fileParts.push(`${head}\n${body}${note}`);
  }
  if (meta.omittedFiles.length) fileParts.push(`[omitted: bundle limit reached, ${meta.omittedFiles.length} more changed file(s): ${meta.omittedFiles.join(', ')}]`);
  parts.push(`## Files created or changed (${changed.length})\n${fileParts.length ? fileParts.join('\n\n') : '(none)'}`);
  const deletedPart = deleted.length ? `## Files deleted\n${deleted.map((d) => `- ${d}`).join('\n')}` : null;
  // The deliverables: the final text and the changed files. An expert: criterion may quote only these (expertText), so a
  // fixture read in a tool result cannot prove a point the delivered work never makes (independent review, fix 2).
  const deliverables = [parts[0], parts[parts.length - 1], ...(deletedPart ? [deletedPart] : [])];
  // The tool calls come after the deliverables and share their limit: they get what the files left, at most one file's worth.
  const tools = toolBlock(toolSessions(runDir, result), Math.max(0, Math.min(maxFileChars, maxBundleChars - used)));
  if (tools) parts.push(tools.text);
  meta.toolCalls = tools ? { calls: tools.calls, shown: tools.shown } : null;
  if (deletedPart) parts.push(deletedPart);
  // The deterministic check results are not shown: the rubric share is meant to judge the outcome on its own, and a
  // judge that reads "PASS tests: 90 of 90" anchors on it (task review F4). `recheck` therefore cannot change a bundle.

  const redacted = redact(parts.join('\n\n'), redactions);
  const { fired } = redacted;
  const scrubbedText = scrubStringCounted(redacted.text, literals);
  const text = scrubbedText.text;
  const expertText = scrubStringCounted(redact(deliverables.join('\n\n'), redactions).text, literals).text;
  let fileReplacements = 0;
  const files = changed.map((f) => {
    const scrubbed = f.binary ? null : scrubStringCounted(f.text, literals);
    fileReplacements += scrubbed?.count ?? 0;
    return { rel: f.rel, created: f.created, binary: Boolean(f.binary), text: scrubbed?.text ?? null, orig: f.orig };
  });
  meta.credsScrubbed = { text: scrubbedText.count, files: fileReplacements };
  // changed and deleted name the workspace files the bundle was built from, so a reader can tell later whether they moved.
  // `files` carries the file texts, credential-scrubbed but not redacted, for local analysis (the quality pack's gating and diff); it is never sent to a judge as is.
  return { text, expertText, fired, meta, changed: changed.map((f) => f.rel), deleted, files };
}

module.exports = { buildBundle, finalTextOf, walk };
