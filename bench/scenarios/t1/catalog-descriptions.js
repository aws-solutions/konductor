#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Lists the name and one-line description of every skill, SOP and agent of a konductor checkout, for the mapping step
// of task authoring. Reads only the frontmatter of SKILL.md and *.sop.md and the "description" key of *.agent-spec.json,
// never a body, except a SOP with no frontmatter description: its first paragraph under `## Overview` stands in (no
// SOP has a frontmatter description, so the mapper saw 19 empty ones; DEBT D-162). Usage: node catalog-descriptions.js <konductor-root> > descriptions.json

const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmValue } = require('../../runner/lib/frontmatter.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const unquote = (s) => s.replace(/^(["'])(.*)\1$/s, '$2');

/** The first paragraph under `## Overview` of a SOP, on one line; '' when it has none. */
function overviewOf(text) {
  const m = /^## Overview[ \t]*\n+([\s\S]*?)(?:\n[ \t]*\n|\n#|$)/m.exec(text);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function catalog(root) {
  const out = [];
  const skills = path.join(root, 'skills');
  for (const e of fs.readdirSync(skills, { withFileTypes: true })) {
    const file = path.join(skills, e.name, 'SKILL.md');
    if (e.isDirectory() && fs.existsSync(file)) out.push({ kind: 'skill', name: e.name, description: unquote(fmValue(frontmatter(read(file)), 'description')) });
  }
  const sops = path.join(root, 'agent-sops');
  for (const f of fs.readdirSync(sops).filter((n) => n.endsWith('.sop.md'))) {
    const text = read(path.join(sops, f));
    out.push({ kind: 'sop', name: f.replace(/\.sop\.md$/, ''), description: unquote(fmValue(frontmatter(text), 'description')) || overviewOf(text) });
  }
  const agents = path.join(root, 'agents');
  for (const f of fs.readdirSync(agents).filter((n) => n.endsWith('.agent-spec.json'))) {
    out.push({ kind: 'agent', name: f.replace(/\.agent-spec\.json$/, ''), description: String(JSON.parse(read(path.join(agents, f))).description ?? '') });
  }
  return out;
}

if (require.main === module) process.stdout.write(`${JSON.stringify(catalog(path.resolve(process.argv[2])), null, 1)}\n`);
module.exports = { catalog, overviewOf };
