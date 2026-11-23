// SPDX-License-Identifier: Apache-2.0
'use strict';

// The units of keep-or-prune stages 2 to 4: stage 2 agent files, stage 3 SOPs, stage 4 always-loaded context (stage 1,
// skills, is cap keep-prune). For each unit: its files and hash, who lists or delegates to it, how its drop arm is built
// (`cap variant --drop`, variant.js), which selection test applies, and whether a frozen baseline exists. Free: it
// reads files only. See bench/docs/keep-prune-stages.md.

const fs = require('node:fs');
const path = require('node:path');
const { scanRepo, loadAgentSpecs, PATH_OF } = require('./scan.js');
const { estTokens } = require('./sections.js');
const { sha256 } = require('../runner/lib/util.js');

const STAGE_OF_KIND = Object.freeze({ agent: 2, sop: 3, context: 4 });
const KIND_LABEL = Object.freeze({ agent: 'agent files', sop: 'SOPs', context: 'always-loaded context' });
/** The agents a user starts: no orchestrator delegates to them, so the stub drop arm would start nothing. */
const ENTRY_AGENTS = Object.freeze(['konductor', 'konductor-cmux-orchestrator', 'konductor-mux-orchestrator']);
/** Where frozen baselines for stages 2 to 4 live, one folder per unit (`<kind>-<name>/baseline.json`). None exist yet. */
const UNIT_BASELINES_DIR = path.join(__dirname, 'unit-baselines');

// The selection test of each kind, and why: what has to happen before the unit's text reaches the model at all.
const SELECTION = Object.freeze({
  agent: { test: 'delegation', note: 'the orchestrator must delegate to the agent: read from the stream which agent got each brief, on requests that should and should not go to it' },
  sop: { test: 'none: user-invoked', note: 'a user names the SOP to run it, so no agent selects it; the effect after load is the whole question' },
  context: { test: 'none: always loaded', note: 'every session of each agent that lists it carries it, so its cost is paid on every session' },
});

/**
 * How the paid steps present a unit of each kind. `answer` is the line the keep arm's one-turn answer reads ahead of
 * the unit's text (kiroprovider.js); `noun` and `tasks` tell the baseline writer and reviewer what the unit is and what
 * a task looks like (unitauthor.js).
 */
const PAID_FRAME = Object.freeze({
  agent: Object.freeze({
    answer: 'You are the agent defined below. Act as it.',
    noun: 'agent definition (the prompt of a specialist agent that a coding-agent orchestrator delegates to)',
    tasks: 'Each task is a brief the orchestrator hands to this agent, and asks for its answer or its next step.',
  }),
  sop: Object.freeze({
    answer: 'The user has started the procedure (SOP) below for this request. Follow it.',
    noun: 'user-invoked procedure (SOP) of a coding agent',
    tasks: 'Each task is a request a user makes while running the procedure, and asks for its output or its next step. When the procedure needs the user\'s yes for its scope or for committing, the prompt gives it.',
  }),
  context: Object.freeze({
    answer: 'The file below is part of your instructions for this session. Follow it.',
    noun: 'always-loaded instruction file of a coding-agent orchestrator',
    tasks: 'Each task gives the orchestrator a situation and asks what it does next.',
  }),
});

/**
 * The loaded unit of one agent file, SOP or context file: `{ id, kind, name, files, sha256, bytes, text }`. `text` is what
 * the model reads: an agent's description and system prompt, or the whole SOP or context file. The hash is over the
 * file's bytes, so any change to the spec (tools, lists, model) moves it. Throws when the tree has no such unit.
 */
function unitManifest({ repo, kind, name }) {
  if (!STAGE_OF_KIND[kind]) throw new Error(`kind ${JSON.stringify(kind)} has no unit stage here (agent, sop or context; skills are stage 1, cap keep-prune)`);
  const rel = PATH_OF[kind](name);
  const file = path.join(repo, rel);
  if (!fs.existsSync(file)) throw new Error(`no ${kind} named ${name}: ${rel} does not exist`);
  const bytes = fs.readFileSync(file);
  let text = bytes.toString('utf8');
  if (kind === 'agent') {
    const j = JSON.parse(text);
    text = [j.config?.description ?? '', j.config?.systemPrompt ?? ''].filter(Boolean).join('\n\n');
  }
  return { id: `${kind}:${name}`, kind, name, files: [rel], sha256: sha256(bytes), bytes: Buffer.byteLength(text), text };
}

/** Who reaches unit `kind:name`: the agents that list it (SOP, context) or may delegate to it (agent), sorted. */
function listedBy(kind, name, specs) {
  const has = { agent: (s) => s.subagents, sop: (s) => s.sops, context: (s) => s.contexts }[kind];
  return specs.filter((s) => has(s).includes(name)).map((s) => s.name).sort();
}

/** The drop arm of a unit for `cap variant --drop`, or null with a reason for an entry agent. */
function ablationOf(kind, name) {
  if (kind === 'agent' && ENTRY_AGENTS.includes(name)) return null;
  return { command: `cap variant --drop ${kind}:${name}`, how: kind === 'agent' ? 'stub' : 'remove file and lists' };
}

/** What a unit needs next, in plain words: the first blocker, or "needs baseline" when only the baseline is missing. */
function statusOf({ kind, name, listed, baseline }) {
  if (kind === 'agent' && ENTRY_AGENTS.includes(name)) return 'entry agent: a user starts it, so it has no drop arm; compare it as an arm of its own, not by keep-or-prune';
  if (!listed.length) return `unreachable: no agent ${kind === 'agent' ? 'delegates to it' : 'lists it'}, so no session ever reads it (an audit finding, not a measurement)`;
  return baseline ? 'baseline frozen' : 'needs baseline';
}

/** The targeted tasks of `id` in a coverage result (`bench.js scenarios coverage --json`), or null when it has none. */
function tasksOf(id, coverage) {
  const row = coverage?.units?.find((u) => u.id === id);
  if (!row) return null;
  return { targeted: [...row.targeted.dev, ...row.targeted.heldOut], heldOut: [...row.targeted.heldOut], controls: [...row.controls] };
}

/**
 * The units of one stage's kind in `repo`, sorted by id. `coverage` (optional) adds each unit's targeted tasks;
 * `baselinesDir` is where frozen unit baselines are looked for. Each unit: { id, kind, name, stage, files, sha256,
 * bytes, estTokens, entry, listedBy, ablation, selection, perSession (context only), baseline, tasks, status }.
 */
function listUnits({ repo, kind, coverage = null, baselinesDir = UNIT_BASELINES_DIR }) {
  if (kind === 'skill') throw new Error('skills are stage 1: use cap keep-prune and cap select');
  if (!STAGE_OF_KIND[kind]) throw new Error(`kind ${JSON.stringify(kind)} has no unit stage (agent, sop or context)`);
  const specs = loadAgentSpecs(repo);
  return [...scanRepo(repo).values()].filter((c) => c.kind === kind).map((c) => {
    const m = unitManifest({ repo, kind, name: c.name });
    const listed = listedBy(kind, c.name, specs);
    const baselineFile = path.join(baselinesDir, `${kind}-${c.name}`, 'baseline.json');
    const baseline = fs.existsSync(baselineFile) ? baselineFile : null;
    return {
      id: m.id, kind, name: c.name, stage: STAGE_OF_KIND[kind], files: m.files, sha256: m.sha256, bytes: m.bytes, estTokens: estTokens(m.bytes),
      entry: kind === 'agent' && ENTRY_AGENTS.includes(c.name), listedBy: listed, ablation: ablationOf(kind, c.name),
      selection: { ...SELECTION[kind], built: false },
      perSession: kind === 'context' ? { estTokens: estTokens(m.bytes), agents: listed.length } : null,
      baseline, tasks: tasksOf(m.id, coverage), status: statusOf({ kind, name: c.name, listed, baseline }),
    };
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const esc = (s) => String(s).replace(/\|/g, '\\|');

/** The stage's unit map as markdown: one row per unit, in the shape of the coverage unit map. */
function renderUnitMap({ kind, units }) {
  const stage = STAGE_OF_KIND[kind];
  const head = ['unit', 'est. tokens', 'reached by', 'drop arm', 'selection test', 'targeted tasks', 'status'];
  const rows = units.map((u) => [u.id, u.estTokens, u.listedBy.join(', ') || 'nobody', u.ablation ? u.ablation.how : 'none (entry agent)', u.selection.test,
    u.tasks ? `${u.tasks.targeted.length} (${u.tasks.heldOut.length} held out, ${u.tasks.controls.length} controls)` : 'not read', u.status]);
  return [
    `# Stage ${stage} unit map: ${KIND_LABEL[kind]}`, '',
    `${units.length} units. Free list from \`cap units --kind ${kind}\`: no model call. A unit needs a frozen baseline (16 tasks with rubrics, written and reviewed by a person) before its stage runs.`, '',
    `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`), '',
  ].join('\n');
}

module.exports = { STAGE_OF_KIND, KIND_LABEL, ENTRY_AGENTS, UNIT_BASELINES_DIR, SELECTION, PAID_FRAME, unitManifest, listUnits, renderUnitMap };
