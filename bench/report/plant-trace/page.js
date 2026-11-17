// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assembles the one self-contained page from one or two built traces. Runs stack top to bottom in one column.

const fs = require('node:fs');
const path = require('node:path');
const { esc, pill, fmtMs, fmtInt, factList } = require('./html.js');
const { laneCells, stepDetail, stateStrip } = require('./rows.js');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
// No network: nothing may load from outside the page. Inline style and script are the page's own files.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

const taskName = (t) => (t ? path.basename(String(t)) : null);

function tokenSummary(tokens) {
  if (tokens.mode === 'run-total') return `${tokens.note}: ${fmtInt(tokens.total?.input)} in, ${fmtInt(tokens.total?.output)} out`;
  if (tokens.mode === 'per-step') return `${tokens.note}. Run total ${fmtInt(tokens.total?.input)} in, ${fmtInt(tokens.total?.output)} out`;
  return tokens.note;
}

/** The run's header: arm, task, model, harness, status, wall time, the counts and the token note. */
function runHeader(trace) {
  const c = trace.counts;
  const facts = [
    pill(`${c.steps} calls`), pill(`${c.blocked} blocked`, c.blocked ? 'warn' : ''),
    pill(`${c.unsafeTries} unsafe tries`, c.unsafeTries ? 'warn' : ''), pill(`${c.unsafeRan} unsafe ran`, c.unsafeRan ? 'bad' : 'ok'),
    pill(`${c.mismatches} mismatches`, c.mismatches ? 'bad' : 'ok'),
  ].join(' ');
  const rows = [
    ['task', esc(taskName(trace.task) ?? 'n/a')], ['model', esc(trace.model ?? 'n/a')], ['harness', esc(trace.harness ?? 'n/a')],
    ['status', esc(trace.status ?? 'n/a')], ['wall time', fmtMs(trace.wallMs)],
  ];
  const warn = trace.badLines ? `<p class="note">${esc(trace.badLines)} log lines were not JSON and were skipped.</p>` : '';
  return `<p class="eyebrow">run</p><h2>${esc(trace.label)}</h2>${factList(rows)}<div class="facts">${facts}</div><p class="note">tokens: ${esc(tokenSummary(trace.tokens))}</p>${warn}`;
}

function mismatchBanner(traces) {
  const bad = traces.filter((t) => t.counts.mismatches);
  if (!bad.length) return `<div class="banner ok">Stream and gateway agree. Every plant call in each agent stream pairs with one gateway call, matched on tool name and args_sha256 (not rpc_id).</div>`;
  const items = bad.map((t) => {
    const lost = t.streamOnly.map((c) => `<li>${esc(t.label)}: the stream has <b>${esc(c.tool ?? 'an unreadable tool')}</b> (${esc(c.argsSha256.slice(0, 12))}) but the gateway never saw it</li>`);
    const miss = t.steps.filter((s) => s.gatewayOnly).map((s) => `<li>${esc(t.label)}: gateway step ${s.n} (${esc(s.tool)}) has no matching stream call</li>`);
    return [...lost, ...miss].join('');
  }).join('');
  return `<div class="banner bad"><b>Stream and gateway disagree.</b> The match is on tool name and args_sha256.<ul>${items}</ul></div>`;
}

const legend = () => `<div class="legend">${pill('allowed', 'ok')} ${pill('blocked by the gateway', 'warn')} ${pill('unsafe attempt that ran', 'bad')}<span class="na">click a cell for the call, its arguments and the gateway's reason</span></div>`;

function tableHead(trace) {
  const label = `tokens${trace.tokens.mode === 'not-recorded' ? ' (not recorded)' : ''}`;
  return `<thead><tr><th>step</th><th class="lead">call</th><th>decision</th><th>time</th><th title="${esc(trace.tokens.note)}">${label}</th><th>plant after</th></tr></thead>`;
}

const stepRows = (trace, lane) => trace.steps.map((s) => `<tr><td class="num">${s.n}</td>${laneCells(s, lane, trace)}</tr>`).join('');

function endRow(trace) {
  const harm = trace.final.harm.length ? pill(`harm at settle: ${trace.final.harm.join(', ')}`, 'bad') : '';
  return `<tr><td class="num">end</td><td class="lead" colspan="4">end of run, after the settle ${harm}</td><td>${stateStrip(trace.final.state)}</td></tr>`;
}

/** One run as one full-width block: its header naming the arm, then every step one below the other. `lane` is its index. */
const runBlock = (trace, lane) => `<section class="panel run">${runHeader(trace)}<div class="scroll"><table>${tableHead(trace)}<tbody>${stepRows(trace, lane)}${endRow(trace)}</tbody></table></div></section>`;

const details = (traces) => traces.map((t, lane) => t.steps.map((s) => stepDetail(s, lane, t)).join('')).join('');

/**
 * The page for `traces`, one or two built traces (`buildTrace`). Each run is one full-width block; with two, the second
 * block sits below the first. A click opens the call's detail in a panel over the right edge. Returns the whole HTML
 * text: one file, its own CSS and script, no outside requests.
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
<div hidden>${details(traces)}</div>
<script>${read('client.js')}</script>
</body>
</html>
`;
}

module.exports = { renderPage };
