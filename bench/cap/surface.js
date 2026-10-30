// SPDX-License-Identifier: Apache-2.0
'use strict';

// What an agent can see of the skills when it starts: the input of the trigger proxy. On kiro-cli there is no skill
// index at startup; the agent has a name filter for the skills server and whatever its system prompt says. On opencode
// the name and description of every skill is in the prompt. The filter comes from a run's recorded startupResources
// when a run is given, otherwise from the agent spec at the base tree.

const fs = require('node:fs');
const path = require('node:path');
const { loadAgentSpecs } = require('./scan.js');
const { skillRecords, filterRecords } = require('./retrieval.js');

const EXCERPT_MAX = 6000;

/** The startupResources the run recorded for an arm (the first non-vanilla arm when none is named). */
function recordedStartup(runDir, armName = null) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(runDir, 'run-config.json'), 'utf8')); } catch (e) { throw new Error(`cannot read ${path.join(runDir, 'run-config.json')}: ${e.code || e.message}`); }
  const arms = cfg.arms ?? [];
  const arm = armName ? arms.find((a) => a.id === armName) : arms.find((a) => a.startupResources && !a.startupResources.builtin);
  if (!arm) throw new Error(`run-config has no arm "${armName}" (arms: ${arms.map((a) => a.id).join(', ') || 'none'})`);
  return arm.startupResources ?? null;
}

// The paragraphs of the prompt and context files that mention skills: the nudges that make an agent look for one.
function skillParagraphs(spec, baseDir) {
  const texts = [spec.prompt];
  for (const f of spec.contextFiles) {
    try { texts.push(fs.readFileSync(path.join(baseDir, 'context', f), 'utf8')); } catch { /* listed but missing: the audit reports it */ }
  }
  const paras = texts.flatMap((t) => t.split(/\n\s*\n/)).map((p) => p.trim()).filter((p) => /skill/i.test(p));
  let out = '';
  for (const p of paras) {
    if (out.length + p.length + 2 > EXCERPT_MAX) break;
    out += `${out ? '\n\n' : ''}${p}`;
  }
  return out;
}

function specFor(baseDir, actingAgent) {
  const specs = loadAgentSpecs(baseDir);
  const spec = specs.find((s) => s.name === actingAgent);
  if (!spec) throw new Error(`no agent spec named "${actingAgent}" at the base ref (agents: ${specs.map((s) => s.name).join(', ')})`);
  return spec;
}

/**
 * { runtime: 'kiro-cli', skillFilter, records, missing, promptExcerpt, source, actingAgent }. `records` are the skills the
 * agent's skills server serves: the tree's skills that pass the filter. `missing` are filter names with no file.
 */
function kiroSurface({ baseDir, actingAgent = 'konductor', fromRun = null, armName = null, excerpt = true }) {
  const spec = specFor(baseDir, actingAgent);
  let skillFilter;
  let source;
  if (fromRun) {
    const rec = recordedStartup(fromRun, armName);
    if (!rec || !Array.isArray(rec.skillFilter)) throw new Error(`run-config has no recorded skill filter for arm "${armName ?? '(first konductor arm)'}"`);
    skillFilter = rec.skillFilter;
    source = `run-config startupResources of arm ${armName ?? '(first konductor arm)'}`;
  } else {
    skillFilter = spec.skills.length ? spec.skills : null;
    source = 'agent spec at the base ref';
  }
  const all = skillRecords(baseDir);
  const records = filterRecords(all, skillFilter);
  const missing = skillFilter ? skillFilter.filter((n) => !n.includes('*') && !all.some((r) => r.name.toLowerCase() === n.toLowerCase())) : [];
  return { runtime: 'kiro-cli', actingAgent, skillFilter, records, missing, promptExcerpt: excerpt ? skillParagraphs(spec, baseDir) : '', source };
}

/** { runtime: 'opencode', skills: [{ name, description }], source }: the skill index opencode puts in the prompt. */
function opencodeSurface({ baseDir, fromRun = null, armName = null }) {
  const all = skillRecords(baseDir);
  let names = null;
  let source = 'every skill in the base tree';
  if (fromRun) {
    const rec = recordedStartup(fromRun, armName);
    if (!rec || !Array.isArray(rec.skillNames)) throw new Error(`run-config has no recorded skill index for arm "${armName ?? '(first konductor arm)'}"`);
    names = new Set(rec.skillNames.map((n) => n.toLowerCase()));
    source = `run-config startupResources of arm ${armName ?? '(first konductor arm)'}`;
  }
  const skills = all.filter((r) => !names || names.has(r.name.toLowerCase())).map((r) => ({ name: r.name, description: r.description }));
  return { runtime: 'opencode', skills, source };
}

module.exports = { kiroSurface, opencodeSurface, recordedStartup, EXCERPT_MAX };
