// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const { aggregateEvents } = require('../runner/lib/harness/opencode-parse.js');
const { runtimeOf } = require('../runner/lib/harness/runtime.js');
const { ANSWER_KEY } = require('../runner/lib/sandbox.js');
const { redact } = require('./redact.js');

// Tool state, not deliverables; listing it would also reveal the arm. Deliverables such as
// .kiro/specs/** are kept. Names match at any depth, paths from the workspace root.
const SKIP_NAMES = new Set(['.git', 'node_modules']);
const SKIP_PATHS = ['.kiro/agents', '.kiro/steering', '.kiro/skills', '.kiro/settings', '.kiro/sessions', '.konductor', '.claude', '.opencode'];
const skipped = (rel) => SKIP_NAMES.has(path.basename(rel)) || SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));

function walk(root, rel = '') {
  const out = [];
  const excluded = { count: 0 };
  const visit = (r) => {
    for (const ent of fs.readdirSync(path.join(root, r), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const sub = path.join(r, ent.name);
      if (ent.isDirectory()) {
        if (skipped(sub)) excluded.count++;
        else visit(sub);
      } else if (ent.isFile() && ent.name !== ANSWER_KEY) out.push(sub);
    }
  };
  if (fs.existsSync(path.join(root, rel))) visit(rel);
  return { files: out, excluded: excluded.count };
}

function readText(file) {
  const buf = fs.readFileSync(file);
  if (!buf.includes(0)) return { text: buf.toString('utf8') };
  return { binary: true, size: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

// kiro-cli: the runFinished event's text. opencode: the last assistant text event of the parent session.
function finalTextOf(runDir, result = null) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return null;
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  return runtimeOf(result) === 'opencode' ? aggregateEvents(events).lastText : aggregateStream(events).finalText;
}

// Autonomy runs only: what the scripted user was asked and what it answered. Judged with the rest of the bundle, so redaction applies.
function conversationBlock(result) {
  if (!Array.isArray(result.questions) || typeof result.turns !== 'number') return null;
  if (!result.questions.length) return '## Conversation\nThe agent asked no question.';
  const lines = result.questions.map((q, i) => `Question ${i + 1} (after turn ${q.turn}): ${q.text}\n${q.answered ? `Reply: ${q.reply ?? ''}` : 'No reply was sent.'}`);
  return `## Conversation\n${lines.join('\n\n')}`;
}

function checkLine(c) {
  // Hidden tests: counts only, never names, paths or output.
  if (c.type === 'tests' && c.tests) return `- ${c.passed ? 'PASS' : 'FAIL'} tests: ${c.tests.passed} of ${c.tests.total} hidden tests passed${c.regression ? `; ${c.regression.passed} of ${c.regression.total} existing tests still pass` : ''}${c.tests.unparsed ? ' (result could not be read)' : ''}`;
  const what = c.path ?? c.cmd ?? '';
  const extra = c.pattern !== undefined ? ` /${c.pattern}/` : '';
  return `- ${c.passed ? 'PASS' : 'FAIL'} ${c.type} ${what}${extra}${c.detail ? ` (${String(c.detail).slice(0, 200)})` : ''}`;
}

// Builds the only view of a run that a judge sees. It is assembled from the
// final text, the files that differ from the fixture, and the check results;
// the transcript and tool calls are never read.
function buildBundle({ runDir, result, fixtureDir, limits, redactions }) {
  const { maxFileChars, maxBundleChars } = limits;
  const meta = { truncatedFiles: [], omittedFiles: [], excluded: 0 };
  const ws = walk(path.join(runDir, 'workspace'));
  meta.excluded = ws.excluded;
  const base = new Set(walk(fixtureDir).files);

  const changed = [];
  for (const rel of ws.files) {
    const mine = readText(path.join(runDir, 'workspace', rel));
    const orig = base.has(rel) ? readText(path.join(fixtureDir, rel)) : null;
    const same = orig && !mine.binary && !orig.binary ? orig.text === mine.text : orig && mine.binary && orig.binary && orig.sha === mine.sha;
    if (!same) changed.push({ rel, created: !orig, ...mine });
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
  if (deleted.length) parts.push(`## Files deleted\n${deleted.map((d) => `- ${d}`).join('\n')}`);
  // After `recheck` the judge keeps seeing the results recorded at run time, so a rechecked run
  // builds the same bundle and its cached judge calls stay valid.
  const shownChecks = result.checksOriginal ?? result.checks ?? [];
  parts.push(`## Deterministic check results\n${shownChecks.map(checkLine).join('\n') || '(none)'}`);

  const { text, fired } = redact(parts.join('\n\n'), redactions);
  return { text, fired, meta };
}

module.exports = { buildBundle, finalTextOf };
