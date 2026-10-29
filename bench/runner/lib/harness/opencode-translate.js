// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rewrites the `claude` harness agent files (tools list) into opencode agent files (permission map).
// The prompt body is copied unchanged.

const fs = require('node:fs');
const path = require('node:path');

// opencode folds Write and Edit into one `edit` permission and has a separate `list` tool.
const TOOL_PERMISSIONS = {
  Read: ['read', 'list'], Write: ['edit'], Edit: ['edit'], Bash: ['bash'], Glob: ['glob'], Grep: ['grep'],
  WebFetch: ['webfetch'], WebSearch: ['websearch'], TodoWrite: ['todowrite'], Skill: ['skill'], Agent: ['task'],
};
// Every tool permission is written explicitly; opencode allows an unmentioned tool.
const ALL_PERMISSIONS = ['bash', 'codesearch', 'edit', 'glob', 'grep', 'list', 'lsp', 'question', 'read', 'skill', 'task', 'todowrite', 'webfetch', 'websearch'];
const MUX_VARIANT = /mux-orchestrator$/;

function parseAgent(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error('agent file has no frontmatter');
  const fm = {};
  let list = null;
  for (const line of m[1].split('\n')) {
    const item = /^- (.*)$/.exec(line);
    if (item && list) { list.push(item[1].trim()); continue; }
    const kv = /^([A-Za-z_-]+):\s?(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2] === '') { list = []; fm[kv[1]] = list; } else { list = null; fm[kv[1]] = kv[2].trim(); }
  }
  return { fm, body: m[2] };
}

// `Agent(a, b)` -> {tool: 'Agent', args: ['a', 'b']}
function splitTool(entry) {
  const m = /^([^(]+)(?:\((.*)\))?$/.exec(entry);
  return { tool: m[1], args: m[2] === undefined ? null : m[2].split(',').map((s) => s.trim()).filter(Boolean) };
}

function permissionsOf(tools) {
  const perm = Object.fromEntries(ALL_PERMISSIONS.map((k) => [k, 'deny']));
  const dropped = [];
  for (const entry of tools) {
    const { tool, args } = splitTool(entry);
    const keys = TOOL_PERMISSIONS[tool];
    if (!keys) { dropped.push(entry); continue; }
    for (const k of keys) perm[k] = 'allow';
    if (tool === 'Agent' && args) perm.task = { '*': 'deny', ...Object.fromEntries(args.map((a) => [a, 'allow'])) };
  }
  return { perm, dropped };
}

const q = (s) => JSON.stringify(s);

function permissionYaml(perm) {
  const lines = ['permission:'];
  for (const k of Object.keys(perm).sort()) {
    if (typeof perm[k] === 'string') { lines.push(`  ${k}: ${perm[k]}`); continue; }
    lines.push(`  ${k}:`);
    for (const [pattern, action] of Object.entries(perm[k])) lines.push(`    ${/^[\w-]+$/.test(pattern) ? pattern : q(pattern)}: ${action}`);
  }
  return lines;
}

function translateAgent({ fm, body }, { model, variant, primary = 'konductor' }) {
  if (!Array.isArray(fm.tools)) throw new Error(`agent ${fm.name} has no tools list`);
  const { perm, dropped } = permissionsOf(fm.tools);
  const head = [
    '---',
    `description: ${q(fm.description ?? '')}`,
    `mode: ${fm.name === primary ? 'primary' : 'subagent'}`,
    `model: ${model}`,
    `variant: ${variant}`,
    ...permissionYaml(perm),
    '---',
  ];
  return { name: fm.name, text: `${head.join('\n')}\n${body}`, dropped };
}

// Writes dstDir/<name>.md for every agent file in srcDir except the mux and cmux orchestrator variants.
function translateAll(srcDir, dstDir, opts) {
  fs.mkdirSync(dstDir, { recursive: true });
  const agents = [];
  const skipped = [];
  const dropped = {};
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.md')).sort()) {
    const parsed = parseAgent(fs.readFileSync(path.join(srcDir, f), 'utf8'));
    if (MUX_VARIANT.test(parsed.fm.name)) { skipped.push(parsed.fm.name); continue; }
    const t = translateAgent(parsed, opts);
    fs.writeFileSync(path.join(dstDir, `${t.name}.md`), t.text);
    agents.push(t.name);
    if (t.dropped.length) dropped[t.name] = t.dropped;
  }
  return { agents: agents.sort(), skipped: skipped.sort(), dropped };
}

module.exports = { parseAgent, translateAgent, translateAll, TOOL_PERMISSIONS, ALL_PERMISSIONS };
