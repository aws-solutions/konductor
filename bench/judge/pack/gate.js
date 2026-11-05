// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which criteria apply to a run. The task declares the artifact types it asks for; the changed files say which were produced.
// A type the task did not ask for is never credited. A type it asked for and did not get scores fail without a model call.

const path = require('node:path');
const { changeStats } = require('./changes.js');
const { proseOf } = require('./detect.js');

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs', '.rb', '.sh', '.c', '.cc', '.cpp', '.h', '.cs', '.kt', '.swift', '.php']);
// A missing README or missing comments is not a failure of the pack: the task's own checks cover a missing README.
const DOC_NOTHING_TYPES = new Set(['comments', 'readme']);

const ext = (rel) => path.extname(rel).toLowerCase();
const isTestPath = (rel) => /(^|\/)(tests?|__tests__|spec|specs)\//i.test(rel) || /(^|\/)(test_[^/]*|[^/]*[._-](test|spec)\.[a-z]+)$/i.test(rel);
const isCode = (rel) => CODE_EXT.has(ext(rel));
const isReadme = (rel) => /^readme(\.[a-z]+)?$/i.test(path.basename(rel));
const isMarkdown = (rel) => ext(rel) === '.md';

const MENTIONS_TESTS = /\b(add|write|extend|update|include|create)\b[^.\n]{0,60}\btests?\b/i;
const FORBIDS_README = /\bdo not (?:change|edit|touch|modify)\b[^.\n]*\bREADME\b/i;

/** The artifact types a task asks for: the pack's declared list for the task id, else an inference from class and prompt. */
function declaredArtifacts(pack, task) {
  const own = pack.taskArtifacts?.[task.id];
  if (Array.isArray(own)) return [...own];
  const out = [];
  const prompt = String(task.prompt || '');
  if (task.class === 'review') out.push('review');
  if (task.class === 'design') out.push('design');
  if (['orchestration', 'hard', 'real', 'autonomy'].includes(task.class)) out.push('code');
  if (task.class !== 'review' && task.class !== 'design' && MENTIONS_TESTS.test(prompt) && out.includes('code')) out.push('tests');
  if (/\bREADME\b/.test(prompt) && !FORBIDS_README.test(prompt) && out.includes('code')) out.push('readme');
  if (/threat[- ]model/i.test(prompt)) out.push('threat-model');
  return out;
}

/**
 * State of each artifact type for one run: present (the agent produced it and the pack can judge it), absent (the task asked
 * for it and nothing was produced), undeclared (the task did not ask), or unjudgeable with the reason (too small, no comments).
 * Nothing is credited for an undeclared type, whatever the agent wrote.
 */
function artifactStates(pack, task, files) {
  const declared = new Set(declaredArtifacts(pack, task));
  const stats = changeStats(files);
  const byRel = new Map(stats.map((s) => [s.rel, s]));
  const pick = (pred) => files.filter((f) => !f.binary && pred(f.rel));
  const codeFiles = pick((r) => isCode(r) && !isTestPath(r));
  const testFiles = pick((r) => isCode(r) && isTestPath(r));
  const readmeFiles = pick(isReadme);
  const mdFiles = pick((r) => isMarkdown(r) && !isReadme(r));
  const sum = (list, key) => list.reduce((n, f) => n + (byRel.get(f.rel)?.[key] ?? 0), 0);
  const addedCode = sum(codeFiles, 'addedCode');
  const addedComments = sum(codeFiles, 'addedComments');
  const min = pack.minAddedCodeLines ?? 0;
  const types = Object.keys(pack.artifactTypes);
  const haveOf = { code: codeFiles, tests: testFiles, readme: readmeFiles, review: mdFiles, design: mdFiles, 'threat-model': mdFiles, guide: mdFiles };
  const state = {};
  for (const t of types) {
    if (t === 'comments') {
      if (!declared.has('code')) state[t] = { s: 'undeclared', reason: 'not asked for' };
      else if (!codeFiles.length) state[t] = { s: 'none', reason: 'no code was changed' };
      else state[t] = addedComments > 0 ? { s: 'present' } : { s: 'none', reason: 'no comments in the changed code' };
      continue;
    }
    if (!declared.has(t)) { state[t] = { s: 'undeclared', reason: 'not asked for' }; continue; }
    const have = haveOf[t] ?? [];
    if (!have.length) state[t] = DOC_NOTHING_TYPES.has(t) ? { s: 'none', reason: `no ${t} change` } : { s: 'absent', reason: `the task asks for ${t} and none was produced` };
    else if (t === 'code' && addedCode < min) state[t] = { s: 'none', reason: `the code change is too small to judge (${addedCode} added code line(s), minimum ${min})` };
    else state[t] = { s: 'present' };
  }
  return { declared: [...declared], state, stats, haveOf };
}

/** Per criterion: judged (some applicable artifact is present), absent (asked for and not produced: scored fail) or na with a reason. */
function applicability(pack, task, files) {
  const art = artifactStates(pack, task, files);
  const decide = (c) => {
    const states = c.appliesTo.map((t) => art.state[t]);
    if (states.some((x) => x.s === 'present')) return { status: c.auto ? 'auto' : 'judged' };
    const gone = states.find((x) => x.s === 'absent');
    if (gone) return { status: 'absent', reason: gone.reason };
    const undeclared = c.appliesTo.filter((t) => art.state[t].s === 'undeclared');
    const other = [...new Set(c.appliesTo.filter((t) => art.state[t].s !== 'undeclared').map((t) => art.state[t].reason))];
    const list = undeclared.length > 2 ? `any of ${undeclared.join(', ')}` : undeclared.join(' or ');
    const asked = undeclared.length ? [`the task does not ask for ${list}`] : [];
    return { status: 'na', reason: [...asked, ...other].join('; ') };
  };
  return { ...art, criteria: pack.criteria.map((c) => ({ criterion: c, ...decide(c), ...(c.auto ? { prose: proseFor(art, c) } : {}) })) };
}

// Files whose prose a criterion reads: those of every artifact type it applies to that is present.
function proseFor(art, criterion) {
  const rels = new Set();
  for (const t of criterion.appliesTo) if (art.state[t]?.s === 'present') for (const f of art.haveOf[t] ?? []) rels.add(f.rel);
  return proseOf(art.stats, [...rels]);
}

module.exports = { isTestPath, isCode, isReadme, declaredArtifacts, artifactStates, applicability };
