// SPDX-License-Identifier: Apache-2.0
'use strict';

// Process signals: how a run was carried out, read from what the runner already recorded (result.json) and from the files the
// run left. Nothing here calls a model and nothing is scored: the judge never sees the transcript, so these are the only
// view of decomposition behavior. A signal that a harness did not record is n/a with the reason, never a guess.

const { buildBundle } = require('../judge/bundle.js');
const { DEFAULTS, effectiveLimits } = require('../judge/config.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const UNNAMED = '(unnamed)';

/**
 * Agents handed work in a run. orch.spawns counts one per stage of a subagent call on Kiro and, for Claude Code, one per Agent
 * tool call; claudeCode.spawned is the result line's own count; subagentCalls is the stream's tool-call count (opencode and
 * runs read before orch existed). The first one present is used, as the 2x2 table does.
 */
const spawnsOf = (result) => {
  const v = result.orch?.spawns ?? result.claudeCode?.spawned ?? result.subagentCalls ?? null;
  return fin(v) ? v : null;
};

// A heading, a bold label or a short line that opens an assumptions or open-questions list.
const SECTION_WORDS = /^(?:key |main |working |my )?(?:assumptions?|open questions?|unresolved questions?|questions? (?:for you|to confirm)|decisions? (?:needed|required)|clarifications? needed|unknowns?)\b/i;
function hasAssumptionsSection(text) {
  if (typeof text !== 'string' || !text) return false;
  let fenced = false;
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.replace(/^[\s#>*_\-|]+/, '').replace(/[*_|\s]+$/, '');
    if (SECTION_WORDS.test(line) && (line.length <= 60 || /:$/.test(line))) return true;
    if (/^\|?\s*(?:id\s*\|\s*)?assumptions?\b[^|]*\|/i.test(raw)) return true;
  }
  return false;
}

/**
 * Signals of one run entry (an element of a loaded run's `runs`). `task` supplies the fixture so the files the run changed can be
 * found. Each signal is { value } or { value: null, na: reason }.
 */
function processSignalsOf(entry, task = null) {
  const r = entry.result;
  const na = (reason) => ({ value: null, na: reason });
  const spawns = spawnsOf(r);
  const noStream = 'the run ended before any agent output was parsed';

  const delegated = r.capInvocation?.delegatedTo;
  const named = Array.isArray(delegated) ? delegated.filter((d) => d.agent !== UNNAMED) : null;
  const unnamed = Array.isArray(delegated) ? delegated.filter((d) => d.agent === UNNAMED).reduce((n, d) => n + d.count, 0) : 0;

  const finalText = typeof r.finalText === 'string' ? r.finalText : null;
  let docFiles = null;
  let docNa = 'the task is not in the task set, so the files the run changed cannot be found';
  if (task?.fixtureDir) {
    try {
      const b = buildBundle({ runDir: entry.dir, result: r, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, DEFAULTS.limits), redactions: [] });
      docFiles = b.files.filter((f) => !f.binary && /\.md$/i.test(f.rel));
    } catch (e) { docNa = `the workspace could not be read (${e.code || e.message})`; }
  }

  return {
    spawns: spawns === null ? na(noStream) : { value: spawns },
    agents: named === null ? na(noStream) : { value: new Set(named.map((d) => d.agent)).size, unnamed },
    assumptionsDoc: docFiles === null ? na(docNa) : { value: docFiles.some((f) => hasAssumptionsSection(f.text)) },
    assumptionsFinal: finalText === null ? na('no final message was recorded') : { value: hasAssumptionsSection(finalText) },
    askedQuestion: typeof r.askedUser === 'boolean' ? { value: r.askedUser } : na('the run did not finish with a final message, so no question could be detected'),
  };
}

const count = (xs, pick) => xs.map(pick).filter((s) => s.value !== null);

function summarizeGroup(entries, tasks) {
  const sig = entries.map((e) => processSignalsOf(e, tasks.get(e.taskId)));
  const numeric = (key) => { const have = count(sig, (s) => s[key]); return { n: have.length, mean: mean(have.map((x) => x.value)) }; };
  const share = (key, test = (v) => v === true) => { const have = count(sig, (s) => s[key]); return { n: have.length, k: have.filter((x) => test(x.value)).length }; };
  const reasons = {};
  for (const key of Object.keys(sig[0] ?? {})) {
    const tally = {};
    for (const s of sig) if (s[key].value === null) tally[s[key].na] = (tally[s[key].na] || 0) + 1;
    reasons[key] = Object.entries(tally).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([reason, n]) => ({ reason, count: n }));
  }
  return {
    runs: entries.length,
    spawns: numeric('spawns'),
    delegated: share('spawns', (v) => v > 0),
    agents: numeric('agents'),
    unnamedSpawns: sig.reduce((n, s) => n + (s.agents.unnamed || 0), 0),
    assumptionsDoc: share('assumptionsDoc'),
    assumptionsFinal: share('assumptionsFinal'),
    asked: share('askedQuestion'),
    naReasons: reasons,
  };
}

/** groups: [{ id, label, run, arm? }] as for summarizeQuality. */
function summarizeProcess({ groups, tasks }) {
  return groups.map((g) => {
    const entries = g.run.runs.filter((e) => e.result.status !== 'budget_skipped' && (!g.arm || e.armId === g.arm));
    return { id: g.id, label: g.label, ...summarizeGroup(entries, tasks) };
  });
}

const f2 = (v) => (fin(v) ? v.toFixed(2) : 'n/a');
const numCell = (c) => (c.n ? `${f2(c.mean)} (n=${c.n})` : 'n/a');
const shareCell = (c) => (c.n ? `${c.k} of ${c.n}` : 'n/a');

const NOTE = 'Process signals describe how the runs were carried out. They are read from result.json and from the files each run left, they are not judged, and they are not part of the quality score or the pack score. They say what an agent did, not whether it was right to do it. n is the number of runs where the signal was recorded.';
const SOURCE = 'Data source. Spawns per run: the stream\'s subagent calls (Kiro: one per stage of a subagent call; Claude Code: one per Agent tool call, or the result line\'s count). Distinct agents: the agent names in those calls, with unnamed calls left out. A vanilla arm that has no subagent tool records 0 spawns, which is a count, not n/a. Assumptions section: a heading, bold label or short line that opens an assumptions or open-questions list, in a changed markdown file or in the final message. Ended on a question: the runner\'s end-of-turn check on the final message (a trailing question, an approval request, or a list under a question); it is a heuristic and is n/a when the run did not finish.';

/** Markdown blocks for a process summary (an array of group summaries). */
function processBlocks(groups, D) {
  const head = ['arm', 'runs', 'spawns per run', 'runs that delegated', 'distinct agents per run', 'assumptions section in a document', 'assumptions section in the final message', 'ended on a question'];
  const rows = groups.map((g) => [g.label, g.runs, numCell(g.spawns), shareCell(g.delegated), numCell(g.agents), shareCell(g.assumptionsDoc), shareCell(g.assumptionsFinal), shareCell(g.asked)]);
  const names = { spawns: 'spawns', agents: 'distinct agents', assumptionsDoc: 'document assumptions', assumptionsFinal: 'final-message assumptions', askedQuestion: 'ended on a question' };
  const why = groups.flatMap((g) => Object.entries(g.naReasons).flatMap(([key, list]) => list.map((r) => `${g.label}, ${names[key]}: n/a in ${r.count} run(s), ${r.reason}`)));
  const unnamed = groups.filter((g) => g.unnamedSpawns).map((g) => `${g.label}: ${g.unnamedSpawns} spawn(s) named no agent`);
  return [
    D.h(3, 'Process signals (descriptive, not scored)'),
    D.note(NOTE),
    D.table(head, rows),
    D.p(SOURCE),
    ...(why.length ? [D.h(4, 'Where a signal was not recorded'), D.list(why)] : []),
    ...(unnamed.length ? [D.p(`Left out of distinct agents: ${unnamed.join('; ')}.`)] : []),
  ];
}

module.exports = { spawnsOf, hasAssumptionsSection, processSignalsOf, summarizeProcess, processBlocks };
