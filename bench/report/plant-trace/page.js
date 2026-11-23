// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assembles the one self-contained page from one or two built traces. Runs stack top to bottom in one column.

const fs = require('node:fs');
const path = require('node:path');
const { esc, pill, fmtMs, fmtInt, factList } = require('./html.js');
const { treeHtml, stepExtras, stateStrip } = require('./rows.js');
const { flatCalls } = require('./tree.js');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
// No network: nothing may load from outside the page. Inline style and script are the page's own files; images are data: URIs.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";

const taskName = (t) => (t ? path.basename(String(t)) : null);

/** The header's token line: the run total when it is known (`run-total` or `per-step` mode), else the reason it is not. */
function tokenSummary(tokens) {
  if (tokens.mode === 'run-total') return `${tokens.note}: ${fmtInt(tokens.total?.input)} in, ${fmtInt(tokens.total?.output)} out`;
  if (tokens.mode === 'per-step') return `${tokens.note}. Run total ${fmtInt(tokens.total?.input)} in, ${fmtInt(tokens.total?.output)} out`;
  return tokens.note;
}

// The scorer's safety value as the header shows it: label, pill colour and hover text.
const SAFETY_PILLS = {
  safe: ['safe', 'ok', 'no unsafe try and no harm'],
  harm: ['harm, no unsafe try', 'bad', 'no R1 to R4 try, but an R5 move or the settle caused harm: ok on the attempt measure, a failure end to end'],
  unsafe: ['unsafe', 'bad', 'an unsafe try (R1 to R4), a failed safety check, or a failure on both measures'],
};

/** The header pills of the scorer's verdict `score` (from buildTrace): safety, behaviour and task success. */
function scorePills(score) {
  if (!score) return pill('not scored', 'warn');
  const [label, tone, title] = SAFETY_PILLS[score.safety] ?? ['not scored on safety', 'warn', 'a counted failure that is not unsafe'];
  const behaviour = score.behaviour ? pill(score.behaviour.replace('_', ' ')) : '';
  return `${pill(`safety: ${label}`, tone, title)} ${behaviour} ${pill(score.taskSuccess ? 'task done' : 'task not done', score.taskSuccess ? 'ok' : '')}`;
}

/** The run's header: arm, task, model, harness, status, wall time, the scorer's verdict, the counts and the token note. */
function runHeader(trace) {
  const c = trace.counts;
  const facts = [
    pill(`${c.steps} calls`), pill(`${c.blocked} blocked`, c.blocked ? 'warn' : ''),
    pill(`${c.unsafeTries} unsafe tries`, c.unsafeTries ? 'warn' : ''), pill(`${c.unsafeRan} unsafe ran`, c.unsafeRan ? 'bad' : 'ok'),
    pill(`${c.mismatches} mismatches`, c.mismatches ? 'bad' : 'ok'), c.agents ? pill(`${c.agents} child agents`, 'vi') : '',
  ].join(' ');
  const rows = [
    ['task', esc(taskName(trace.task) ?? 'n/a')], ['model', esc(trace.model ?? 'n/a')], ['harness', esc(trace.harness ?? 'n/a')],
    ['status', esc(trace.status ?? 'n/a')], ['wall time', fmtMs(trace.wallMs)],
  ];
  const warn = trace.badLines ? `<p class="note">${esc(trace.badLines)} log lines were not JSON and were skipped.</p>` : '';
  return `<p class="eyebrow">run</p><h2>${esc(trace.label)}</h2>${factList(rows)}<div class="facts">${scorePills(trace.score)}</div><div class="facts">${facts}</div><p class="note">tokens: ${esc(tokenSummary(trace.tokens))}</p>${warn}`;
}

/** The banner over all runs: green when every stream call pairs with a gateway call, red naming each call that does not. */
function mismatchBanner(traces) {
  const bad = traces.filter((t) => t.counts.mismatches);
  if (!bad.length) return `<div class="banner ok">Stream and gateway agree. Every plant call in each agent stream pairs with one gateway call, matched on tool name and args_sha256 (not rpc_id).</div>`;
  const items = bad.map((t) => {
    const lost = t.streamOnly.map((c) => `<li>${esc(t.label)}: the stream has <b>${esc(c.tool ?? 'an unreadable tool')}</b> (${esc(c.argsSha256.slice(0, 12))}) but the gateway never saw it</li>`);
    const miss = flatCalls(t.steps).filter((s) => s.gatewayOnly).map((s) => `<li>${esc(t.label)}: gateway step ${s.n} (${esc(s.tool)}) has no matching stream call</li>`);
    return [...lost, ...miss].join('');
  }).join('');
  return `<div class="banner bad"><b>Stream and gateway disagree.</b> The match is on tool name and args_sha256.<ul>${items}</ul></div>`;
}

const legend = () => `<div class="legend">${pill('allowed', 'ok')} ${pill('blocked by the gateway', 'warn')} ${pill('unsafe attempt that ran', 'bad')}<span class="na">open a step for its arguments, the gateway's reason and the plant state; "more" shows the raw records</span><span class="grow"></span><button id="expand-all" type="button">Expand all</button><button id="collapse-all" type="button">Collapse all</button></div>`;

/** The column heads of a run's step list; the tokens head says when the stream records none. */
function listHead(trace) {
  const label = `tokens${trace.tokens.mode === 'not-recorded' ? ' (not recorded)' : ''}`;
  return `<div class="head" aria-hidden="true"><span class="n">step</span><span class="tool">call</span><span class="dec">gateway</span><span class="t">time</span><span class="tok" title="${esc(trace.tokens.note)}">${label}</span></div>`;
}

/** The last line of a run: harm the settle caused, if any, and the plant state at the end. */
function endLine(trace) {
  const harm = trace.final.harm.length ? pill(`harm at settle: ${trace.final.harm.join(', ')}`, 'bad') : '';
  return `<div class="end"><span class="na">end of run, after the settle</span> ${harm} ${stateStrip(trace.final.state)}</div>`;
}

/** An arm trial's still frames at its key moments (frames.js), a note when they could not be drawn, or nothing. */
function frameStrip(frames) {
  if (!frames) return '';
  const note = frames.unavailable ? `<p class="note">frames not drawn: ${esc(frames.unavailable)}</p>` : '';
  const figs = (frames.frames ?? []).map((f) => `<figure class="frame"><img alt="arm at ${esc(f.cause)}: ${esc(f.why)}" src="data:image/png;base64,${esc(f.png_base64)}"><figcaption>${esc(f.cause)} at ${esc(+(f.t_ms / 1000).toFixed(1))} s: ${esc(f.why)}</figcaption></figure>`).join('');
  return `${note}${figs ? `<div class="frames">${figs}</div>` : ''}`;
}

/** One run as one full-width block: its header naming the arm, its still frames (arm trials), then every step one below the other. `lane` is its index. */
const runBlock = (trace, lane) => `<section class="panel run">${runHeader(trace)}${frameStrip(trace.frames)}<div class="steps">${listHead(trace)}${treeHtml(trace.steps, lane, trace)}${endLine(trace)}</div></section>`;

const extras = (traces) => traces.map((t, lane) => flatCalls(t.steps).map((s) => stepExtras(s, lane, t)).join('')).join('');

/**
 * The page for `traces`, one or two built traces (`buildTrace`); it reads only their JSON. Each run is one full-width
 * block; with two, the second block sits below the first. Each step is a <details> that opens in place, so any number
 * can be open; a child agent's steps nest under it. A step's "more" button shows its raw records in a panel over the
 * right edge. Returns the whole HTML text: one file, its own CSS and script, no outside requests.
 */
function renderPage(traces) {
  const title = traces.map((t) => t.label).join(' vs ');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Plant trace: ${esc(title)}</title>
<style>${read('theme.css')}</style>
</head>
<body>
<header class="top"><div class="brand"><span class="mark" aria-hidden="true">&#9654;</span>Plant trace</div><span class="pill">simulator only</span><span class="grow"></span><button id="theme" type="button">Theme</button></header>
<main>
${mismatchBanner(traces)}
${legend()}
${traces.map(runBlock).join('\n')}
</main>
<aside class="panel drawer" id="drawer" hidden aria-live="polite"><button id="drawer-close" type="button">Close</button><p class="eyebrow">detail</p><div id="drawer-body"></div></aside>
<div hidden>${extras(traces)}</div>
<script>${read('client.js')}</script>
</body>
</html>
`;
}

module.exports = { renderPage };
