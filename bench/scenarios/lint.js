// SPDX-License-Identifier: Apache-2.0
'use strict';

// Prompt leak lint (plan 4.5). A prompt must not teach the method: it may not name a konductor skill, SOP or agent,
// use a term from the fixed method list, or tell the agent not to ask on a task where questions are allowed.
// A v3 task (one with a `phase`) must also record where it came from: authorship.source, and a licence when the
// source is a public one. Pure functions over task objects; the CLI reads the names from a konductor tree.

const { loadTaskFiles } = require('./files.js');

// The fixed method list. Acronyms are matched in capitals only ("RICE" is a method, "rice" is food); phrases ignore case.
// Plain deliverable names a user would say (ADR, postmortem, threat model, runbook) are not in this list.
const METHOD_ACRONYMS = ['STRIDE', 'DREAD', 'PASTA', 'RICE', 'ICE', 'INVEST', 'WSJF', 'MECE', 'DACI', 'RACI', 'JTBD', 'MoSCoW'];
const METHOD_PHRASES = [
  'given/when/then', 'given when then', 'gherkin', 'five whys', '5 whys', 'kano model', 'jobs to be done', 'eisenhower matrix', 'pre-mortem', 'premortem',
  'c4 model', 'moscow prioritization', 'story mapping', 'impact mapping', 'wardley map', 'cynefin',
];
const NO_ASK = [/\bdo(?:n't| not)\s+ask\b/i, /\bwithout\s+asking\b/i, /\bno\s+(?:clarifying\s+)?questions\b/i, /\bnever\s+ask\b/i];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const BOUND = (core) => `(?<![A-Za-z0-9_-])${core}(?![A-Za-z0-9_-])`;

/**
 * The regexes that detect a unit name in prose. A hyphenated name (`k-plan`, `threat-modeling`) is matched as written, which
 * an ordinary sentence never produces. A one-word name (`verification`, `constraints`) is also an everyday word, so it counts
 * only in code style: in backticks or quotes, or next to the word skill, SOP or agent.
 * shortcut: a plain one-word mention such as "use verification" is not caught; upgrade when a reviewed prompt shows one.
 */
function nameMatchers(catalog) {
  const out = [];
  for (const [kind, names] of [['skill', catalog.skills], ['sop', catalog.sops], ['agent', catalog.agents]]) {
    for (const name of names ?? []) {
      const n = esc(name);
      const re = name.includes('-')
        ? new RegExp(BOUND(`(?:${kind}:|${kind}-)?${n}`), 'i')
        : new RegExp(`(?:\`${n}\`|"${n}"|'${n}'|\\b(?:skill|sop|agent)s?\\s+(?:called\\s+|named\\s+)?${n}\\b|\\b${n}\\s+(?:skill|sop|agent)\\b)`, 'i');
      out.push({ kind, name, re });
    }
  }
  return out;
}

/** The unit names of a scanned konductor tree (`cap/scan.js` scanRepo result): { skills, sops, agents }. */
function catalogOfScan(scan) {
  const pick = (kind) => [...scan.values()].filter((c) => c.kind === kind).map((c) => c.name).sort();
  return { skills: pick('skill'), sops: pick('sop'), agents: pick('agent') };
}

const isV3 = (task) => task.phase !== undefined;
const blank = (v) => typeof v !== 'string' || !v.trim();

/** Findings for the prompt of one task: [{ rule, detail }]. */
function promptFindings(task, matchers) {
  const found = [];
  // A fresh-session task's later prompts are read the same way.
  const prompt = [task.prompt ?? '', ...(task.freshSessions ?? []).map((s) => s?.prompt ?? '')].map(String).join('\n\n');
  for (const m of matchers) {
    if (m.re.test(prompt)) found.push({ rule: 'names-unit', detail: `names the ${m.kind} "${m.name}"` });
  }
  for (const a of METHOD_ACRONYMS) {
    if (new RegExp(BOUND(esc(a)), a === 'MoSCoW' ? 'i' : '').test(prompt)) found.push({ rule: 'method-term', detail: `uses the method term "${a}"` });
  }
  const lower = prompt.toLowerCase();
  for (const p of METHOD_PHRASES) {
    if (new RegExp(BOUND(esc(p))).test(lower)) found.push({ rule: 'method-term', detail: `uses the method term "${p}"` });
  }
  const questions = task.questions ?? 'allowed';
  if (questions === 'allowed') {
    for (const re of NO_ASK) {
      const m = re.exec(prompt);
      if (m) { found.push({ rule: 'no-ask', detail: `says "${m[0]}" on a task where questions are allowed` }); break; }
    }
  }
  return found;
}

/** Findings for a v3 task's authorship record. Old tasks (no phase) are exempt. */
function authorshipFindings(task) {
  if (!isV3(task)) return [];
  const a = task.authorship;
  if (!a || typeof a !== 'object') return [{ rule: 'authorship', detail: 'a v3 task needs authorship' }];
  const s = a.source;
  if (s === undefined || s === null || s === '') return [{ rule: 'authorship', detail: 'authorship.source is missing (a public source, or "original")' }];
  if (s === 'original') return [];
  if (typeof s !== 'object') return [{ rule: 'authorship', detail: 'authorship.source must be "original" or an object with url, licence, licenceCheckedAt and use' }];
  const found = [];
  for (const k of ['url', 'licence', 'licenceCheckedAt', 'use']) {
    if (blank(s[k])) found.push({ rule: 'authorship', detail: k === 'licence' ? 'authorship.source.licence is empty' : `authorship.source.${k} is missing` });
  }
  return found;
}

/** All findings of one task: [{ taskId, rule, detail }]. */
function lintTask(task, matchers) {
  return [...promptFindings(task, matchers), ...authorshipFindings(task)].map((f) => ({ taskId: task.id, ...f }));
}

/** Lints every task under `dir`. Returns { tasks, findings: [{ taskId, file, rule, detail }] }. */
function lintDir(dir, catalog) {
  const matchers = nameMatchers(catalog);
  const items = loadTaskFiles(dir);
  const findings = items.flatMap(({ file, task }) => lintTask(task, matchers).map((f) => ({ ...f, file })));
  return { tasks: items.length, findings };
}

module.exports = { lintTask, lintDir, nameMatchers, catalogOfScan, promptFindings, authorshipFindings, METHOD_ACRONYMS, METHOD_PHRASES };
