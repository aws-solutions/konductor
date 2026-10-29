// SPDX-License-Identifier: Apache-2.0
'use strict';

const { renderSkillsMarkdown } = require('./skills.js');

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`);
const f = (v, d = 2) => (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d));

function stat(s, d = 2, scale = 1) {
  if (!s || s.median === null) return 'n/a';
  const v = (x) => f(x / scale, d);
  return `${v(s.median)} [${v(s.ciLow)}, ${v(s.ciHigh)}]`;
}

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function rubricCell(c) {
  if (!c.rubric) return 'n/a';
  const parts = Object.entries(c.rubric.byJudge).map(([j, s]) => `${j} ${f(s.mean)} (raw ${f(s.meanRaw)})${s.errors ? ` (${s.errors} err)` : ''}`);
  return [...parts, `mean ${f(c.rubric.meanOfJudges.mean)} (raw ${f(c.rubric.meanOfJudges.meanRaw)})`].join('<br>');
}

// Cost figures always carry the failure rates and say when censored runs make them lower bounds.
function costNote(c) {
  const cost = c.cost ?? c.credits;
  const lower = cost.censoredRuns ? `, lower bound (${cost.censoredRuns} censored)` : '';
  const r = c.rates;
  return `timeout ${pct(c.timeoutRate)}${lower}; error ${pct(r.error)}, infra ${pct(r.infraError)}, model mismatch ${pct(r.modelMismatch)}, checks failed ${pct(r.checksFailed)}${c.skipped ? `, ${c.skipped} budget-skipped` : ''}`;
}

function hiddenCell(c) {
  const h = c.hidden;
  if (!h) return 'n/a';
  return `${pct(h.meanFraction)} (${Math.round(h.allPassShare * h.runs)} of ${h.runs} runs pass all)`;
}

function pairCell(c) {
  if (!c.pairwise) return '-';
  const t = c.pairwise.total;
  return `${t.win}/${t.tie}/${t.loss}${t.positionInconsistent ? ` (${t.positionInconsistent} pos-inconsistent)` : ''}${t.errors ? ` (${t.errors} err)` : ''}`;
}

// The hidden-tests column sits right after "pass" and appears only when some arm in the scope has scores.
const hasHidden = (report, arms, scope) => arms.some((a) => report.arms[a][scope].hidden);
function qHead(head, report, arms, scope) {
  if (!hasHidden(report, arms, scope)) return head;
  const i = head.indexOf('pass') + 1;
  return [...head.slice(0, i), 'hidden tests passed', ...head.slice(i)];
}
function withHidden(row, c, arms, report, scope) {
  if (!hasHidden(report, arms, scope)) return row;
  return [...row.slice(0, 5), hiddenCell(c), ...row.slice(5)];
}

function scopeSection(report, scope) {
  if (report.harness === 'opencode') return scopeSectionOpencode(report, scope);
  const arms = Object.keys(report.arms).filter((a) => report.arms[a][scope]);
  const quality = arms.map((a) => {
    const c = report.arms[a][scope];
    const st = `${c.byStatus.success}/${c.byStatus.timeout}/${c.byStatus.error}${c.skipped ? ` +${c.skipped} skipped` : ''}`;
    return withHidden([a, c.n, st, pct(c.successRate), pct(c.checkPassRate), pct(c.askedUserRate), rubricCell(c), pairCell(c), `${f(c.credits.perSuccessfulRun)}<br>${costNote(c)}`], c, arms, report, scope);
  });
  const eff = arms.map((a) => {
    const c = report.arms[a][scope];
    const e = c.efficiency;
    return [a, `${c.efficiencyRuns} of ${c.n}`, `${stat(e.credits)}<br>${costNote(c)}`, stat(e.modelCalls, 1), stat(e.toolCalls, 1), stat(e.subagentCalls, 1), stat(e.wallClockMs, 1, 1000), stat(e.estTokens, 0)];
  });
  return [
    `### ${scope}`,
    table(qHead(['arm', 'n', 'ok/timeout/error', 'success', 'pass', 'asked user', 'rubric score, scored (raw judge verdicts)', `win/tie/loss vs ${report.baseline}`, 'credits per successful run'], report, arms, scope), quality),
    '',
    table(['arm', 'clean passes in medians', 'credits', 'modelCalls', 'toolCalls', 'subagentCalls', 'wallClock s', 'estTokens (estimate)'], eff),
  ].join('\n');
}

// opencode cells use real tokens and list-price USD; there are no credits.
function scopeSectionOpencode(report, scope) {
  const arms = Object.keys(report.arms).filter((a) => report.arms[a][scope]);
  const quality = arms.map((a) => {
    const c = report.arms[a][scope];
    const st = `${c.byStatus.success}/${c.byStatus.timeout}/${c.byStatus.error}${c.skipped ? ` +${c.skipped} skipped` : ''}`;
    return withHidden([a, c.n, st, pct(c.successRate), pct(c.checkPassRate), pct(c.askedUserRate), rubricCell(c), pairCell(c), `${f(c.cost.perSuccessfulRun, 3)}<br>${costNote(c)}`], c, arms, report, scope);
  });
  const eff = arms.map((a) => {
    const c = report.arms[a][scope];
    const e = c.efficiency;
    return [a, `${c.efficiencyRuns} of ${c.n}`, `${stat(e.costUsd, 3)}<br>${costNote(c)}`, stat(e.tokens, 0), stat(e.modelCalls, 1), stat(e.toolCalls, 1), stat(e.subagentCalls, 1), stat(e.wallClockMs, 1, 1000)];
  });
  return [
    `### ${scope}`,
    table(qHead(['arm', 'n', 'ok/timeout/error', 'success', 'pass', 'asked user', 'rubric score, scored (raw judge verdicts)', `win/tie/loss vs ${report.baseline}`, 'USD per successful run'], report, arms, scope), quality),
    '',
    table(['arm', 'clean passes in medians', 'USD (list price)', 'tokens (input + output + cache read + cache write)', 'modelCalls', 'toolCalls', 'subagentCalls', 'wallClock s'], eff),
  ].join('\n');
}

const HOW_TO_READ_OPENCODE = 'How to read: efficiency cells (USD, tokens, calls, wall clock) are `median [95% bootstrap CI of the median]` over clean passes only, meaning status success, no infrastructure error, no model mismatch and every deterministic check passed. Failed runs never enter a median; they are shown as rates beside every cost figure. "success" is the share of runs that finished cleanly; "pass" also needs every check to pass. "USD per successful run" is the total charged over all executed runs divided by clean passes, so failures raise it. USD is list price computed by opencode from token counts (input, output, cache read, cache write); it is not a bill. Tokens and calls are summed over the parent session and every subagent session read from the session database. Prompt-cache reads depend on whether a run started within about 5 minutes of another, so cache read and cost carry run-order noise. A timed-out run is charged the rows present at the kill or the arm median, whichever is larger. "asked user" is the share of runs whose final message ended with a question or an approval request. Win/tie/loss counts pairwise verdicts of the arm against the baseline, pooled over judges.';

function renderMarkdown(report) {
  const r = report.run;
  const out = [
    '# Benchmark report',
    '',
    `Run: ${r.dir}  `,
    `Suite: ${r.suite ?? 'n/a'}, model ${r.model}, effort ${r.effort}, ${r.taskIds.length} task(s), ${report.harness === 'opencode' ? `opencode ${r.harnessVersion ?? 'n/a'}` : `kiro-cli ${r.kiroCliVersion ?? 'n/a'}`}  `,
    `Baseline: ${report.baseline}. Judges: ${report.judges.join(', ') || 'none (run the judge command for rubric and pairwise results)'}`,
    '',
    report.harness === 'opencode' ? HOW_TO_READ_OPENCODE : 'How to read: efficiency cells (credits, calls, wall clock, tokens) are `median [95% bootstrap CI of the median]` over clean passes only, meaning status success, no infrastructure error, no model mismatch and every deterministic check passed. Failed runs never enter a median, so they cannot make an arm look cheap; they are shown as rates beside every cost figure (timeout, error, infra, model mismatch, checks failed, budget-skipped). "success" is the share of runs that finished cleanly; "pass" also needs every check to pass. "credits per successful run" is the total charged over all executed runs divided by clean passes, so failures raise it; a run killed before its final metering event is charged the runner\'s ledger value, not its partial figure. Tokens are not exposed by kiro-cli, so credits are the cost measure and estTokens is transcript characters / 4, an estimate. "asked user" is the share of runs whose final message ended with a question or an approval request. Win/tie/loss counts pairwise verdicts of the arm against the baseline, pooled over judges.',
    '',
  ];
  const flags = [];
  const rc = report.checksRecheck;
  if (rc) flags.push(`- checks: "pass" uses rechecked results for ${rc.rechecked} of ${rc.runs} run(s) (task checks revised after the run; ${rc.flippedToPass} run(s) changed from failing to passing, ${rc.flippedToFail} from passing to failing). The checks recorded at run time are kept under checksOriginal in each result.json.`);
  for (const [arm, scopes] of Object.entries(report.arms)) {
    for (const [scope, c] of Object.entries(scopes)) for (const msg of c.flags) flags.push(`- ${arm} / ${scope}: ${msg}`);
  }
  if (report.judging?.panel?.small) flags.push(`- judge panel: ${report.judging.panel.families.length} model family(ies) (${report.judging.panel.families.join(', ')}); run with --allow-small-panel, so judge agreement is weak evidence`);
  out.push('## Flags', '', flags.length ? flags.join('\n') : 'None.', '');
  out.push('## Results', '');
  for (const scope of report.scopes) out.push(scopeSection(report, scope), '');
  if (report.judging) {
    out.push('## Judging', '', table(['judge', 'records', 'errors', 'calls (cached)', 'parse failures', 'credits (all invocations)', 'median latency s', 'quote not found', 'downgraded (quote missing)'],
      Object.entries(report.judging.byJudge).map(([j, s]) => [j, s.records, s.errors, `${s.calls} (${s.cachedCalls})`, s.parseFailures, f(s.credits, 3), f(s.medianLatencyMs === null ? null : s.medianLatencyMs / 1000, 1), pct(s.unverifiedQuoteRate), s.evidenceDowngraded])));
    out.push('', `Total judge spend over all invocations: ${f(report.judging.spentCredits, 3)} credits. Cached calls cost 0 and show the latency measured when they ran. Pairwise results where the two orderings disagreed: ${report.judging.positionInconsistent}`, '');
    out.push('Rubric score: "scored" lowers a verdict one level when the judge\'s evidence quote is not found in the output (ellipsis, case, whitespace and markdown emphasis are ignored when matching); "raw" is the judge\'s own verdicts. "quote not found" is the share of quoted criteria whose quote was not found.', '');
    if (report.judging.stale?.length) {
      out.push(`Left out of every score and tally (${report.judging.stale.length} record(s)): judged against an earlier version of the rubric, answer key or prompt. They are still in judgments.json. Re-run the judge command to refresh them.`, '');
    }
    if (report.judging.notJudged.length) {
      out.push(`Not judged (${report.judging.notJudged.length}): ${report.judging.notJudged.map((x) => `${x.armId}/${x.taskId}/#${x.replicate} (${x.reason})`).join(', ')}`, '');
    }
  }
  if (report.skills) out.push(renderSkillsMarkdown(report.skills), '');
  return out.join('\n');
}

module.exports = { renderMarkdown };
