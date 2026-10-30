// SPDX-License-Identifier: Apache-2.0
'use strict';

// Lists the capabilities of a tree (skills/, agents/, agent-sops/, context/) and reads the agent specs.

const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmInfo } = require('../runner/lib/frontmatter.js');

const KINDS = ['skill', 'agent', 'sop', 'context'];

// Where a capability of each kind lives, relative to the tree root.
const PATH_OF = {
  skill: (n) => `skills/${n}/SKILL.md`,
  agent: (n) => `agents/${n}.agent-spec.json`,
  sop: (n) => `agent-sops/${n}.sop.md`,
  context: (n) => `context/${n}.md`,
};

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const names = (dir, pick) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).map(pick).filter(Boolean).sort(); } catch { return []; }
};

// The first paragraph under "## Overview", which is what a SOP says about itself.
function sopOverview(text) {
  const m = /^##\s+Overview\s*\n+([\s\S]*?)(?:\n\s*\n|\n##\s|$)/m.exec(text);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function descriptionOf(kind, name, text) {
  if (kind === 'skill') {
    const info = fmInfo(frontmatter(text), 'description');
    return { text: info.value, style: info.style, present: info.present && info.value.length > 0 };
  }
  if (kind === 'sop') { const t = sopOverview(text); return { text: t, style: 'overview', present: t.length > 0 }; }
  if (kind === 'agent') {
    let d = '';
    try { d = JSON.parse(text)?.config?.description ?? ''; } catch { /* reported by the spec loader */ }
    return { text: d, style: 'json', present: d.length > 0 };
  }
  return { text: '', style: 'none', present: false };
}

/** Every capability under `root`, keyed by id (`skill:alpha`). `bytes` is the size of the defining file. */
function scanRepo(root) {
  const out = new Map();
  const add = (kind, name) => {
    const rel = PATH_OF[kind](name);
    const text = readText(path.join(root, rel));
    if (text === null) return;
    out.set(`${kind}:${name}`, { id: `${kind}:${name}`, kind, name, path: rel, bytes: Buffer.byteLength(text), description: descriptionOf(kind, name, text), text });
  };
  for (const n of names(path.join(root, 'skills'), (e) => (e.isDirectory() ? e.name : null))) add('skill', n);
  for (const n of names(path.join(root, 'agents'), (e) => (/\.agent-spec\.json$/.test(e.name) ? e.name.replace(/\.agent-spec\.json$/, '') : null))) add('agent', n);
  for (const n of names(path.join(root, 'agent-sops'), (e) => (/\.sop\.md$/.test(e.name) ? e.name.replace(/\.sop\.md$/, '') : null))) add('sop', n);
  for (const n of names(path.join(root, 'context'), (e) => (e.isFile() && /\.md$/.test(e.name) ? e.name.replace(/\.md$/, '') : null))) add('context', n);
  return out;
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * The agent specs of a tree, reduced to what decides reachability on kiro: the skill, SOP and context lists the
 * installed agent turns into --skill-name-filter, --agent-sop-filter and resources, the subagents it may spawn,
 * and the prompt and resource entries counted at startup. Context names drop their .md suffix.
 */
function loadAgentSpecs(root) {
  const dir = path.join(root, 'agents');
  const specs = [];
  for (const f of names(dir, (e) => (/\.agent-spec\.json$/.test(e.name) ? e.name : null))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const dep = j.dependencies ?? {};
    const kiro = j.clientConfig?.kiroCli ?? {};
    const sub = [...list(dep.subagents?.agentNames), ...list(kiro.toolsSettings?.subagent?.availableAgents)];
    specs.push({
      name: j.name ?? f.replace(/\.agent-spec\.json$/, ''),
      file: `agents/${f}`,
      skills: list(dep.skills?.skillNames),
      sops: list(dep.agentSops?.agentSopNames),
      contexts: list(dep.context?.contextNames).map((c) => c.replace(/\.md$/, '')),
      contextFiles: list(dep.context?.contextNames),
      subagents: [...new Set(sub)].sort(),
      prompt: typeof j.config?.systemPrompt === 'string' ? j.config.systemPrompt : '',
      resources: list(kiro.resources),
      claudeSkills: list(j.clientConfig?.claudeCli?.skills),
    });
  }
  return specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

module.exports = { scanRepo, loadAgentSpecs, PATH_OF, KINDS, sopOverview };
