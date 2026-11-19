#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Blindness audit of one kiro-cli stream-json file from an author, map or review call. The authoring HOME is not a
// sandbox, so the model could read files outside its directory. Prints JSON: { skillReads, crossBatch, memories },
// and exits 1 when the call read a konductor skills/, agent-sops/, agents/ or context/ path, or had account memories
// attached. A read of another batch's scratch dir is reported, not fatal.
// Usage: node audit.js <stream.out> [<own-scratch-dir-name>]

const fs = require('node:fs');

// Paths named in tool-call inputs only (titles and raw inputs), not in the model's prose or in file contents it wrote.
function toolInputs(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_call"') && !line.includes('"tool_call_update"')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const u = ev?.data?.update;
    if (!u || (u.sessionUpdate !== 'tool_call' && u.sessionUpdate !== 'tool_call_update')) continue;
    out.push(JSON.stringify({ title: u.title ?? '', input: u.rawInput ?? null }));
  }
  return out;
}

function audit(text, own = 't1auth') {
  const inputs = toolInputs(text);
  const unit = /(?:^|[\s"'=/])(?:[^\s"']*\/)?(skills|agent-sops|agents|context)\/[^\s"']+/;
  const konductor = /konductor|worktrees|\/bench\/|\.kiro\/(skills|agents|steering)/;
  const skillReads = inputs.filter((s) => unit.test(s) && konductor.test(s));
  const scratch = /scratch\/[0-9a-f]+\/(t\d+[a-z]*|t\d+auth|t\d+work)\b/g;
  const crossBatch = [...new Set(inputs.flatMap((s) => [...s.matchAll(scratch)].map((m) => m[1])))].filter((d) => d !== own && d !== 't1' && d !== 't1b');
  const memories = (text.match(/"memories":\[\{/g) || []).length;
  return { skillReads: skillReads.slice(0, 5), crossBatch, memories };
}

if (require.main === module) {
  const r = audit(fs.readFileSync(process.argv[2], 'utf8'), process.argv[3]);
  console.log(JSON.stringify(r));
  if (r.skillReads.length || r.memories) process.exitCode = 1;
}

module.exports = { audit };
