// SPDX-License-Identifier: Apache-2.0
'use strict';

// What an arm starts with, read from its scratch HOME and working directory after the install and before the agent
// starts: the effective agent, the MCP servers it can load, the steering and rules files, the skills, and any link into
// the invoking user's real ~/.kiro or ~/.claude. No model is called. run-one writes it as <run>/startup.json, so a study
// can prove that a vanilla arm got nothing and a konductor arm got only konductor's own install.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readJsonOrNull: readJson } = require('./util.js');
const isInside = (p, dir) => { const r = path.relative(dir, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const filesUnder = (dir) => {
  const out = [];
  const walk = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
};
const skillCount = (dir) => { try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))).length; } catch { return 0; } };

const skillDirs = (dir) => { try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))); } catch { return []; } };

/**
 * The konductor skills an install put where its runtime serves them from: the skills MCP server's root
 * (~/.konductor/skills) on Kiro CLI, ~/.claude/skills on Claude Code. `sop-<name>` dirs are SOPs the install wraps as
 * skills (~/.kiro/skills on Kiro CLI), counted apart in `sops`. A konductor-noskills arm has 0 skills and keeps its SOPs.
 */
function installedSkills(home, runtime) {
  const cc = runtime === 'claude-code';
  const served = skillDirs(path.join(home, cc ? '.claude/skills' : '.konductor/skills'));
  const wrapped = cc ? served : skillDirs(path.join(home, '.kiro/skills'));
  return { skills: served.filter((n) => !n.startsWith('sop-')).length, sops: wrapped.filter((n) => n.startsWith('sop-')).length };
}

/** The variant.json a `cap variant` dir arm carries beside its tree, reduced to what names the arm; null for other arms. */
function variantOf(arm) {
  if (!arm?.dir) return null;
  const v = readJson(path.join(path.dirname(arm.dir), 'variant.json'));
  if (!v?.variantId) return null;
  return { variantId: v.variantId, armName: v.armName ?? null, base: v.base?.commitSha ?? null, ops: (v.ops ?? []).map((o) => `${o.op} ${o.id}`), variantHash: v.variantHash ?? null };
}

/** Symlinks below `root` (depth-limited) whose target resolves into one of `forbidden`. */
function linksInto(root, forbidden, maxDepth = 6) {
  const hits = [];
  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        let target = null;
        try { target = fs.realpathSync(p); } catch { target = path.resolve(d, fs.readlinkSync(p)); }
        if (forbidden.some((f) => isInside(target, f))) hits.push({ link: p, target });
      } else if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return hits;
}

/** MCP server names in an mcpServers object, each with the file that declares it. */
const serversOf = (file) => Object.keys(readJson(file)?.mcpServers ?? {}).map((name) => ({ name, source: file }));

/**
 * The startup record of one run.
 *   runtime  'kiro-cli' or 'claude-code' (others get the common fields only)
 *   arm      the resolved arm (vanilla, agent, agentOverride)
 *   home     the run's scratch HOME; cwd: its working directory
 *   realHome the invoking user's home, whose ~/.kiro and ~/.claude must never reach the run
 *   strictMcp  Claude Code only: the command passes --strict-mcp-config with no --mcp-config, so no MCP server loads
 */
function startupRecord({ runtime, arm, home, cwd, realHome = os.homedir(), strictMcp = false }) {
  const forbidden = [path.join(realHome, '.kiro'), path.join(realHome, '.claude'), path.join(realHome, '.claude.json')];
  const rec = {
    runtime,
    // The run's HOME is neither the real home nor inside its ~/.kiro or ~/.claude (a scratch dir elsewhere under the
    // real home is fine: nothing reads from it unless a link points out of it, which realHomeLinks catches).
    homeIsolated: path.resolve(home) !== path.resolve(realHome) && !forbidden.some((f) => isInside(path.resolve(home), f)),
    realHomeLinks: [...linksInto(home, forbidden), ...linksInto(cwd, forbidden)],
    agent: null, agentSource: null, mcpServers: [], mcpIgnored: [], steering: [], skills: 0,
    // The konductor skills the arm can load, and the cap variant it was built as (konductor-noskills: 0 skills).
    konductorSkills: installedSkills(home, runtime), variant: variantOf(arm),
  };
  if (runtime === 'kiro-cli') {
    const settings = readJson(path.join(home, '.kiro/settings/cli.json')) ?? {};
    const configured = settings['chat.defaultAgent'] ?? null;
    rec.agent = arm.agentOverride ?? arm.agent ?? configured ?? 'kiro_default';
    rec.agentSource = arm.agentOverride || arm.agent ? '--agent' : configured ? 'settings chat.defaultAgent' : 'built-in default';
    const agentFile = [path.join(cwd, '.kiro/agents', `${rec.agent}.json`), path.join(home, '.kiro/agents', `${rec.agent}.json`)].find((f) => fs.existsSync(f));
    rec.mcpServers = [
      ...(agentFile ? serversOf(agentFile) : []),
      ...serversOf(path.join(home, '.kiro/settings/mcp.json')),
      ...serversOf(path.join(cwd, '.kiro/settings/mcp.json')),
    ];
    rec.steering = [...filesUnder(path.join(home, '.kiro/steering')), ...filesUnder(path.join(cwd, '.kiro/steering'))];
    rec.skills = skillCount(path.join(home, '.kiro/skills')) + skillCount(path.join(cwd, '.kiro/skills'));
  } else if (runtime === 'claude-code') {
    const configDir = path.join(home, '.claude');
    const settings = readJson(path.join(configDir, 'settings.json')) ?? {};
    rec.agent = arm.agentOverride ?? arm.agent ?? settings.agent ?? 'default';
    rec.agentSource = arm.agentOverride || arm.agent ? '--agent' : settings.agent ? 'settings agent' : 'built-in default';
    const declared = [...serversOf(path.join(configDir, '.claude.json')), ...serversOf(path.join(home, '.claude.json')), ...serversOf(path.join(cwd, '.mcp.json'))];
    if (strictMcp) rec.mcpIgnored = declared;
    else rec.mcpServers = declared;
    rec.steering = [
      ...filesUnder(path.join(configDir, 'rules')),
      ...[path.join(configDir, 'CLAUDE.md'), path.join(cwd, 'CLAUDE.md'), path.join(cwd, '.claude/CLAUDE.md')].filter((f) => fs.existsSync(f)),
    ];
    rec.skills = skillCount(path.join(configDir, 'skills')) + skillCount(path.join(cwd, '.claude/skills'));
  }
  // Paths are written relative to the run's HOME or cwd, so the record carries no host path.
  const rel = (p) => (isInside(p, home) ? `~/${path.relative(home, p)}` : isInside(p, cwd) ? `./${path.relative(cwd, p)}` : p);
  rec.mcpServers = rec.mcpServers.map((s) => ({ name: s.name, source: rel(s.source) }));
  rec.mcpIgnored = rec.mcpIgnored.map((s) => ({ name: s.name, source: rel(s.source) }));
  rec.steering = rec.steering.map(rel);
  rec.realHomeLinks = rec.realHomeLinks.map((h) => ({ link: rel(h.link), target: h.target }));
  return rec;
}

module.exports = { startupRecord, installedSkills, variantOf };
