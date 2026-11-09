#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Per-layer canary arm builder (bench/CANARY-LAYERS.md). Extracts a konductor ref into a scratch directory and adds one
// distinct token to each layer of the delivery path, so a run shows which layers reach the model without being forced.
// Nothing here calls a model and nothing is written into the repository.
//
//   node bench/scripts/canary-layers.js build --ref SHA --base DIR [--repo DIR] [--index-skill S] [--body-skill S] [--sops a,b] [--rules-file F] [--ctx-file F]
//   node bench/scripts/canary-layers.js commands --base DIR [--repo DIR] [--replicates N] [--agents a,b]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const BENCH = path.resolve(__dirname, '..');
const REPO = path.resolve(BENCH, '..');
const LAYERS = ['rules', 'prompt', 'index', 'skill', 'sop', 'ctx'];
const ENTRY_AGENTS = ['konductor', 'k-architect', 'k-tpm', 'k-developer', 'k-product-manager', 'k-quality-assurance'];
const ARM = 'k-layers';
const DEFAULTS = Object.freeze({
  rulesFile: 'context/k-core-rules.md',
  ctxFile: 'context/k-orchestrator-routing-rules.md',
  indexSkill: 'workspace-skills',
  bodySkill: 'humanize-writing',
  sops: ['k-plan', 'k-design-doc-creation', 'k-code-review-workflow', 'k-test-coverage-review'],
});
const TOKEN_SHAPE = /kd-cl-(rules|prompt|index|skill|sop|ctx)-[0-9a-f]{8}/g;

const makeToken = (layer, hex = crypto.randomBytes(4).toString('hex')) => `kd-cl-${layer}-${hex}`;
const markerLine = (token) => `Delivery marker: ${token}`;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function extract(repo, ref, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', ref], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dest], { input: tar });
}

function appendLine(file, token) {
  if (!fs.existsSync(file)) throw new Error(`${file} not found in the extracted tree`);
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${text.endsWith('\n') ? text : `${text}\n`}\n${markerLine(token)}\n`);
}

/** The token goes inside the frontmatter description, which is the text the skill index returns. */
function tagDescription(file, token) {
  const text = fs.readFileSync(file, 'utf8');
  let hit = false;
  const next = text.replace(/^description: (.*)$/m, (_, d) => { hit = true; return `description: ${d} (marker ${token})`; });
  if (!hit) throw new Error(`${file} has no single-line description`);
  fs.writeFileSync(file, next);
}

function specFiles(dir) {
  const agents = path.join(dir, 'agents');
  return fs.readdirSync(agents).filter((n) => n.endsWith('.agent-spec.json')).sort().map((n) => path.join(agents, n));
}

function tagPrompts(dir, token) {
  const changed = [];
  for (const file of specFiles(dir)) {
    const spec = readJson(file);
    if (typeof spec.config?.systemPrompt !== 'string') continue;
    spec.config.systemPrompt = `${spec.config.systemPrompt.replace(/\n*$/, '')}\n\n${markerLine(token)}\n`;
    fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
    changed.push(spec.name);
  }
  return changed;
}

/** What the agent specs promise to deliver, per entry agent and layer. Used only to label the report, never to score it. */
function expectedDelivery(dir, sites, agents = ENTRY_AGENTS) {
  const specs = Object.fromEntries(specFiles(dir).map((f) => { const s = readJson(f); return [s.name, s]; }));
  const out = {};
  for (const agent of agents) {
    const dep = specs[agent]?.dependencies ?? {};
    const skills = dep.skills?.skillNames ?? [];
    const sops = dep.agentSops?.agentSopNames ?? [];
    const ctx = dep.context?.contextNames ?? [];
    out[agent] = {
      rules: ctx.includes(path.basename(sites.rules.file)),
      prompt: sites.prompt.agents.includes(agent),
      index: skills.includes(sites.index.skill),
      skill: skills.includes(sites.skill.skill),
      sop: sites.sop.names.some((n) => sops.includes(n)),
      ctx: ctx.includes(path.basename(sites.ctx.file)),
    };
  }
  return out;
}

/** Adds the six tokens to an extracted tree and returns the site record. `tokens` may be given to keep them across a rebuild. */
function applyLayers(dir, { tokens = {}, rulesFile = DEFAULTS.rulesFile, ctxFile = DEFAULTS.ctxFile, indexSkill = DEFAULTS.indexSkill, bodySkill = DEFAULTS.bodySkill, sops = DEFAULTS.sops } = {}) {
  if (indexSkill === bodySkill) throw new Error('--index-skill and --body-skill must differ, or the two layers cannot be told apart');
  const t = Object.fromEntries(LAYERS.map((l) => [l, tokens[l] ?? makeToken(l)]));
  appendLine(path.join(dir, rulesFile), t.rules);
  appendLine(path.join(dir, ctxFile), t.ctx);
  const agents = tagPrompts(dir, t.prompt);
  tagDescription(path.join(dir, 'skills', indexSkill, 'SKILL.md'), t.index);
  appendLine(path.join(dir, 'skills', bodySkill, 'SKILL.md'), t.skill);
  const sopNames = [];
  for (const name of sops) {
    const file = path.join(dir, 'agent-sops', `${name}.sop.md`);
    if (!fs.existsSync(file)) throw new Error(`SOP ${name} not found at agent-sops/${name}.sop.md`);
    appendLine(file, t.sop);
    sopNames.push(name);
  }
  const sites = {
    rules: { file: rulesFile }, ctx: { file: ctxFile }, prompt: { agents }, index: { skill: indexSkill }, skill: { skill: bodySkill }, sop: { names: sopNames },
  };
  return { tokens: t, sites, expected: expectedDelivery(dir, sites) };
}

function build({ repo = REPO, ref, base, ...opts }) {
  if (!ref) throw new Error('build needs --ref');
  if (!base) throw new Error('build needs --base');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const file = path.join(base, 'layers.json');
  const previous = fs.existsSync(file) ? readJson(file) : null;
  const src = path.join(base, 'layers-src');
  extract(repo, sha, src);
  const keep = previous?.sha === sha ? previous.tokens : {};
  const applied = applyLayers(src, { tokens: keep, ...opts });
  const record = { schemaVersion: 1, builtAt: new Date().toISOString(), sha, arm: ARM, spec: `${ARM}=dir:${src}`, ...applied };
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  fs.chmodSync(file, 0o600);
  return record;
}

function commandsFor(record, { repo = REPO, base, replicates = 3, agents = ENTRY_AGENTS, model = 'claude-sonnet-5.5', budget = 12 } = {}) {
  return agents.map((agent) => {
    const armAgent = agent === 'konductor' ? '' : ` --arm-agent ${ARM}=${agent}`;
    return `node bench/runner/bench.js run --suite canary-layers --arms ${record.spec}${armAgent} --agent-engine v3 --model ${model} --replicates ${replicates} --parallel 1 --budget-credits ${budget} --run-credit-limit 8 --repo-root ${repo} --out ${path.join(base, 'runs', agent)}`;
  });
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); opts[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  return opts;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const o = parseArgs(rest);
  const repo = o.repo ? path.resolve(o.repo) : REPO;
  if (cmd === 'build') {
    const rec = build({
      repo, ref: o.ref, base: o.base && path.resolve(o.base),
      ...(o['rules-file'] && { rulesFile: o['rules-file'] }), ...(o['ctx-file'] && { ctxFile: o['ctx-file'] }),
      ...(o['index-skill'] && { indexSkill: o['index-skill'] }), ...(o['body-skill'] && { bodySkill: o['body-skill'] }),
      ...(o.sops && { sops: String(o.sops).split(',') }),
    });
    console.log(`built ${rec.spec}\nsha ${rec.sha}\ntokens are in ${path.join(path.resolve(o.base), 'layers.json')} (mode 600)`);
    return;
  }
  if (cmd === 'commands') {
    if (!o.base) throw new Error('commands needs --base');
    const base = path.resolve(o.base);
    const rec = readJson(path.join(base, 'layers.json'));
    console.log(commandsFor(rec, { repo, base, replicates: Number(o.replicates ?? 3), agents: o.agents ? String(o.agents).split(',') : ENTRY_AGENTS }).join('\n'));
    return;
  }
  throw new Error('usage: canary-layers.js build --ref SHA --base DIR | commands --base DIR [--replicates N] [--agents a,b]');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}

module.exports = { LAYERS, ENTRY_AGENTS, ARM, DEFAULTS, TOKEN_SHAPE, makeToken, markerLine, applyLayers, expectedDelivery, build, commandsFor };
