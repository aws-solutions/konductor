// SPDX-License-Identifier: Apache-2.0
'use strict';

// Prompt leak lint (plan 4.5). A prompt must not teach the method: it may not name a konductor skill, SOP or agent,
// use a term from the fixed method list, or tell the agent not to ask on a task where questions are allowed.
// A v3 task (one with a `phase`) must also record where it came from: authorship.source, and a licence when the
// source is a public one. A v3 task's judges may carry at most 30% of its score (judge-share). lint-files.js adds the
// rules that read a task's fixture and hidden files. Known findings sit in lint-baseline.json, each with its DEBT row:
// they are reported but do not fail the lint; a new finding fails it, and so does a baseline entry that no longer matches.

const fs = require('node:fs');
const path = require('node:path');
const { loadTaskFiles } = require('./files.js');
const { judgedRubric } = require('../runner/lib/expert-rubric.js');
const { fileFindings } = require('./lint-files.js');
const { staleDateWarnings } = require('./dates.js');
const { DEFAULT_WEIGHTS } = require('../report/scores.js');

const BASELINE_FILE = path.join(__dirname, 'lint-baseline.json');
const MAX_JUDGE_SHARE = 0.3;

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

/**
 * The judges' share of a v3 task's score under the default weights (report/scores.js): the rubric weight over the
 * weights of the parts the task has. A task with no `tests` check drops the hidden share, so its judges carry 0.3 of
 * 0.5 (60%), not 30%. Null when the task has no rubric or expert key.
 */
function judgeShare(task, weights = DEFAULT_WEIGHTS) {
  if (!(task.rubric ?? []).length && !(task.expertKey ?? []).length) return null;
  const checks = task.checks ?? [];
  const parts = [weights.rubric];
  if (checks.some((c) => c?.type === 'tests')) parts.push(weights.hidden);
  if (checks.some((c) => c?.type !== 'tests' && c?.kind !== 'format')) parts.push(weights.checks);
  return weights.rubric / parts.reduce((a, b) => a + b, 0);
}

function judgeShareFindings(task) {
  if (!isV3(task)) return [];
  const share = judgeShare(task);
  return share !== null && share > MAX_JUDGE_SHARE + 1e-9
    ? [{ rule: 'judge-share', where: 'checks', detail: `judges carry ${Math.round(share * 100)}% of the score (at most ${MAX_JUDGE_SHARE * 100}%); add a tests check` }]
    : [];
}

// A judged rubric item carries its three anchors in the criterion text (review fix 3, DEBT D-117). The `expert-key`
// placeholder is replaced by the task's expertKey items, which carry their own weak answers.
const ANCHORS = ['Fail:', 'Partial:', 'Pass:'];
function rubricAnchorFindings(task) {
  if (!isV3(task)) return [];
  return (task.rubric ?? []).filter((r) => r && r.id !== 'expert-key' && !ANCHORS.every((a) => String(r.criterion ?? '').includes(a)))
    .map((r) => ({ rule: 'rubric-anchor', where: `rubric#${r.id}`, detail: `rubric item "${r.id}" has no ${ANCHORS.join(' / ')} anchors in its criterion` }));
}

// A judged task needs at least MIN_CRITERIA criteria the judge scores (FW-31, DEBT D-225): with one or two, one judge line
// decides the task. The count is the rubric the judge sees, so each expertKey item counts and its placeholder does not.
const MIN_CRITERIA = 3;
function rubricCountFindings(task) {
  if (!isV3(task) || (!(task.rubric ?? []).length && !(task.expertKey?.items ?? []).length)) return [];
  const n = judgedRubric(task.rubric ?? [], task.expertKey).length;
  return n < MIN_CRITERIA
    ? [{ rule: 'rubric-count', where: 'rubric', detail: `the judges score ${n} criterion${n === 1 ? '' : 's'}; a judged task needs ${MIN_CRITERIA} or more, so no single line decides it` }]
    : [];
}

/** All findings of one task that need only its JSON: [{ taskId, rule, detail }]. */
function lintTask(task, matchers) {
  return [...promptFindings(task, matchers), ...authorshipFindings(task), ...judgeShareFindings(task), ...rubricAnchorFindings(task), ...rubricCountFindings(task)].map((f) => ({ taskId: task.id, ...f }));
}

const findingKey = (f) => `${f.taskId}|${f.rule}|${f.where ?? ''}`;

/** The known findings: { "<taskId>|<rule>|<where>": "D-nnn ..." }. {} when the file is absent. */
function readBaseline(file = BASELINE_FILE) {
  if (!fs.existsSync(file)) return {};
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return j.known ?? {};
}

/**
 * Lints every task under `dir`. Returns { tasks, findings: [{ taskId, file, rule, where, detail, known? }], stale: [key],
 * warnings: [{ taskId, file, rule, where, detail }] }; warnings (stale prompt dates as of `now`) never fail the lint.
 * `known` is the baseline entry of a finding it lists; `stale` the baseline keys of the linted tasks that no longer match.
 */
function lintDir(dir, catalog, { baseline = {}, now = new Date() } = {}) {
  const matchers = nameMatchers(catalog);
  const items = loadTaskFiles(dir);
  // Stale dates move with the calendar, so they warn and never fail the lint (a suite that went red by date alone).
  const warnings = items.flatMap(({ file, task }) => staleDateWarnings(task, { now }).map((w) => ({ taskId: task.id, file, ...w })));
  const findings = items.flatMap(({ file, task }) => [
    ...lintTask(task, matchers),
    ...fileFindings(task, file).map((f) => ({ taskId: task.id, ...f })),
  ].map((f) => ({ ...f, file, ...(baseline[findingKey(f)] ? { known: baseline[findingKey(f)] } : {}) })));
  const ids = new Set(items.map((i) => i.task.id));
  const seen = new Set(findings.map(findingKey));
  const stale = Object.keys(baseline).filter((k) => ids.has(k.split('|')[0]) && !seen.has(k)).sort();
  return { tasks: items.length, findings, stale, warnings };
}

module.exports = { MIN_CRITERIA, lintTask, lintDir, readBaseline, judgeShare, findingKey, BASELINE_FILE, nameMatchers, catalogOfScan, promptFindings, authorshipFindings, METHOD_ACRONYMS, METHOD_PHRASES };
