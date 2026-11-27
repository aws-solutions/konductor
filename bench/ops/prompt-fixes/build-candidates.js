#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds the konductor-adaptive candidate files from konductor c042c7ba and the edits in edits.js. Free: reads git,
// writes files only.
//   node build-candidates.js --repo R --out DIR [--json] [--with p1p2]
// --with p1p2 adds the reply-check edits P1 and P2 (edits.js REPLY_EDITS) after fixes 1 to 9: the candidate arm of
// reports/adaptive-prompt-cap-check-2026-11-27.md. Without it the files are the frozen konductor-adaptive arm's.
// Writes every changed or new file under DIR at its repo path (context/..., agents/..., cli/README.md, docs/...), so DIR
// can be a fresh directory for the arm or a checkout of c042c7ba for konductor's own tests. Prints the cap variant ops:
// --replace ID=FILE for each changed installed file, --add for the new context file, and --to-agent.
// Exit 1 when an edit's text is not found exactly once (the c042 text moved); 64 on a usage error.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { BASE, EDITS, REPLY_EDITS, ARM_FILES } = require('./edits.js');

// The edit sets --with may add.
const SETS = { p1p2: REPLY_EDITS };
const USAGE = 'usage: build-candidates.js --repo R --out DIR [--json] [--with p1p2]';

const PROMPT_KEY = '#systemPrompt';

function onlyOnce(text, needle, fix, label) {
  const first = text.indexOf(needle);
  const count = first < 0 ? 0 : text.split(needle).length - 1;
  if (count !== 1) throw new Error(`fix ${fix}: ${label} ${JSON.stringify(needle.slice(0, 60))} found ${count} times (want 1)`);
  return first;
}

/**
 * Applies `edits` in order. `read(rel)` returns a base file's text. Returns a Map of repo path to new text, for every
 * file an edit touched or created. A `<spec>#systemPrompt` file edits that agent spec's config.systemPrompt string.
 */
function applyEdits(read, edits) {
  const texts = new Map();
  const specs = new Map();
  const get = (file) => {
    if (file.endsWith(PROMPT_KEY)) {
      const rel = file.slice(0, -PROMPT_KEY.length);
      if (!specs.has(rel)) specs.set(rel, JSON.parse(read(rel)));
      return specs.get(rel).config.systemPrompt;
    }
    if (!texts.has(file)) texts.set(file, read(file));
    return texts.get(file);
  };
  const set = (file, text) => {
    if (file.endsWith(PROMPT_KEY)) specs.get(file.slice(0, -PROMPT_KEY.length)).config.systemPrompt = text;
    else texts.set(file, text);
  };
  for (const e of edits) {
    const text = get(e.file);
    if (e.append !== undefined) { set(e.file, text + e.append); continue; }
    if (e.before !== undefined) {
      const at = onlyOnce(text, e.before, e.fix, 'before text');
      set(e.file, text.slice(0, at) + e.after + text.slice(at + e.before.length));
      continue;
    }
    const start = onlyOnce(text, e.from, e.fix, 'span start');
    const end = start + onlyOnce(text.slice(start), e.to, e.fix, 'span end');
    const span = text.slice(start, end);
    if (e.moveTo) {
      const prior = texts.has(e.moveTo) ? texts.get(e.moveTo) : '';
      texts.set(e.moveTo, prior + span);
      set(e.file, text.slice(0, start) + text.slice(end));
    } else {
      set(e.file, text.slice(0, start) + e.after + text.slice(end));
    }
  }
  const out = new Map(texts);
  for (const [rel, j] of specs) out.set(rel, `${JSON.stringify(j, null, 2)}\n`);
  return out;
}

function gitRead(repo, sha) {
  return (rel) => {
    const r = spawnSync('git', ['-C', repo, 'show', `${sha}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`cannot read ${rel} at ${sha}: ${r.stderr.trim()}`);
    return r.stdout;
  };
}

/**
 * The cap variant arguments for the files written under `out`. Each flag is given once with comma-joined values:
 * the bench option parser keeps only the last of a repeated flag (DEBT D-294).
 */
function variantArgs(out) {
  const join = (m) => Object.entries(m).map(([id, rel]) => `${id}=${path.join(out, rel)}`).join(',');
  return ['--replace', join(ARM_FILES.replace), '--add', join(ARM_FILES.add), '--to-agent', ARM_FILES.addTo.join(',')];
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opt.json = true;
    else if ((a === '--repo' || a === '--out' || a === '--with') && argv[i + 1]) opt[a.slice(2)] = argv[++i];
    else { console.error(USAGE); return 64; }
  }
  if (!opt.repo || !opt.out || (opt.with !== undefined && !SETS[opt.with])) { console.error(USAGE); return 64; }
  const edits = opt.with ? [...EDITS, ...SETS[opt.with]] : EDITS;
  let files;
  try { files = applyEdits(gitRead(opt.repo, BASE), edits); } catch (e) { console.error(`STOP: ${e.message}`); return 1; }
  const out = path.resolve(opt.out);
  const written = [];
  for (const [rel, text] of [...files].sort()) {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    written.push({ file: rel, sha256: crypto.createHash('sha256').update(text).digest('hex') });
  }
  const result = { base: BASE, edits: edits.length, with: opt.with ?? null, written, variantArgs: variantArgs(out) };
  if (opt.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const w of written) console.log(`wrote ${w.file} ${w.sha256.slice(0, 12)}`);
    console.log(`cap variant ops: ${result.variantArgs.join(' ')}`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { applyEdits, variantArgs, main };
