// SPDX-License-Identifier: Apache-2.0
'use strict';

// The capability kinds of a konductor tree (skill, agent, SOP, context), one JSON file per kind in cap/units/. scan.js
// and units.js read every fact about a kind from here, so a new kind is a new file. Free: reads files only.
//
// Fields of a kind file:
//   kind         the id (`agent` in `agent:k-dev`)
//   stage        the keep-or-prune stage (1 is skills, cap keep-prune; 2 and up are unit stages, cap unit-stage)
//   label        the plural noun a unit map heads with; article: the singular noun with its article ("a SOP")
//   path         where one lives below the tree root, with {name}; "<dir>/{name}/..." means one folder per unit
//   listedIn     the agent-spec list (scan.js loadAgentSpecs) that names it: skills, subagents, sops or contexts
//   description  how scan.js reads what it says about itself: frontmatter, overview, agent-spec or none
//   text         (optional) agent-spec: the model reads the spec's description and system prompt, not the whole file
//   reachedBy    (optional) the verb for an agent that reaches it (default "lists it")
//   dropArm      (optional) how `cap variant --drop` removes it (default "remove file and lists")
//   entryAgents  (optional) units a user starts: no drop arm
//   perSession   (optional) true when every session of a listing agent carries it
//   claimNoun, selection {test, note}, paidFrame {answer, noun, tasks}: needed for a unit stage (stage 2 and up)

const fs = require('node:fs');
const path = require('node:path');

const UNIT_KINDS_DIR = path.join(__dirname, 'units');
const REQUIRED = ['kind', 'stage', 'label', 'article', 'path', 'listedIn', 'description'];
const UNIT_STAGE_FIELDS = ['claimNoun', 'selection', 'paidFrame'];
const DESCRIPTIONS = new Set(['frontmatter', 'overview', 'agent-spec', 'none']);

/** Problems with one parsed kind file (an empty list when it is usable). */
function kindProblems(k) {
  const p = REQUIRED.filter((f) => k[f] === undefined).map((f) => `needs ${f}`);
  if (p.length) return p;
  if (!Number.isInteger(k.stage) || k.stage < 1) p.push('stage must be a whole number from 1');
  if (!/^[^{}]+\/\{name\}[^{}]*$/.test(k.path)) p.push('path must be "<dir>/{name}..." with one {name}');
  if (!DESCRIPTIONS.has(k.description)) p.push(`description must be one of ${[...DESCRIPTIONS].join(', ')}`);
  if (k.stage > 1) p.push(...UNIT_STAGE_FIELDS.filter((f) => k[f] === undefined).map((f) => `a unit stage kind needs ${f}`));
  return p;
}

/**
 * Every kind file in `dir`, checked and frozen, in stage order (then by id). Throws naming the file on a bad field or on
 * two files with one kind id.
 */
function loadUnitKinds(dir = UNIT_KINDS_DIR) {
  const seen = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const k = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const problems = kindProblems(k);
    if (problems.length) throw new Error(`${f}: ${problems.join('; ')}`);
    if (seen.has(k.kind)) throw new Error(`${f}: kind ${k.kind} is also in ${seen.get(k.kind).file}`);
    const facts = { ...k };
    delete facts.$comment;
    seen.set(k.kind, { file: f, k: Object.freeze(facts) });
  }
  return [...seen.values()].map((v) => v.k).sort((a, b) => a.stage - b.stage || (a.kind < b.kind ? -1 : 1));
}

/** `{ dir, nameOf(dirent) }`: the folder a kind's units live in, and the unit name a folder entry stands for (or null). */
function layoutOf(k) {
  const [dir, rest] = k.path.split('/{name}');
  if (rest.startsWith('/')) return { dir, nameOf: (e) => (e.isDirectory() ? e.name : null) };
  return { dir, nameOf: (e) => (e.isFile() && e.name.endsWith(rest) && e.name.length > rest.length ? e.name.slice(0, -rest.length) : null) };
}

/** The relative path of unit `name` of kind `k`. */
const pathOf = (k, name) => k.path.replace('{name}', name);

/** "a", "a or b", "a, b or c". */
const orList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

/** The kinds as a markdown table: what `cap units --list` prints. */
function renderKindList(kinds) {
  const head = ['kind', 'stage', 'label', 'path', 'selection test'];
  return [
    `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
    ...kinds.map((k) => `| ${k.kind} | ${k.stage} | ${k.label} | \`${k.path}\` | ${k.selection?.test ?? 'cap select (stage 1)'} |`), '',
  ].join('\n');
}

const UNIT_KINDS = loadUnitKinds();

module.exports = { UNIT_KINDS_DIR, UNIT_KINDS, loadUnitKinds, kindProblems, layoutOf, pathOf, orList, renderKindList };
