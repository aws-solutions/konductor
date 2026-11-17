// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assembles the one self-contained page from one or two built traces (lanes). Lanes line up by step number.

const fs = require('node:fs');
const path = require('node:path');
const { esc, pill, fmtMs, fmtInt, factList } = require('./html.js');
const { laneCells, emptyCells, stepDetail, stateStrip } = require('./rows.js');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
// No network: nothing may load from outside the page. Inline style and script are the page's own files.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

const taskName = (t) => (t ? path.basename(String(t)) : null);

function tokenSummary(tokens) {
  if (tokens.mode === 'run-total') return `${tokens.note}: ${fmtInt(tokens.total?.input)} in, ${fmtInt(tokens.total?.output)} out`;
  if (tokens.mode === 'per-step') return `${tokens.note}. Run total ${fmtInt(tokens.total?.input)} in, ${fmtInt(tokens.total?.output)} out`;
  return tokens.note;
}

function lanePanel(trace) {
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
  return `<section class="panel"><p class="eyebrow">run</p><h2>${esc(trace.label)}</h2>${factList(rows)}<div class="facts">${facts}</div><p class="note">tokens: ${esc(tokenSummary(trace.tokens))}</p>${warn}</section>`;
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

function header(traces) {
  const lane = (t) => `<th class="lane" colspan="5">${esc(t.label)}</th>`;
  const cols = traces.map((t) => `<th class="lead">call</th><th>decision</th><th>time</th><th title="${esc(t.tokens.note)}">tokens${t.tokens.mode === 'not-recorded' ? ' (not recorded)' : ''}</th><th>plant after</th>`).join('');
  return `<thead><tr><th></th>${traces.map(lane).join('')}</tr><tr><th>step</th>${cols}</tr></thead>`;
}

function stepRows(traces) {
  const total = Math.max(...traces.map((t) => t.steps.length));
  return Array.from({ length: total }, (_, i) => {
    const cells = traces.map((t, lane) => (t.steps[i] ? laneCells(t.steps[i], lane, t) : emptyCells())).join('');
    return `<tr><td class="num">${i + 1}</td>${cells}</tr>`;
  }).join('');
}

function endRow(traces) {
  const cells = traces.map((t) => {
    const harm = t.final.harm.length ? pill(`harm at settle: ${t.final.harm.join(', ')}`, 'bad') : '';
    return `<td class="lead" colspan="4">end of run, after the settle ${harm}</td><td>${stateStrip(t.final.state)}</td>`;
  }).join('');
  return `<tr><td class="num">end</td>${cells}</tr>`;
}

const details = (traces) => traces.map((t, lane) => t.steps.map((s) => stepDetail(s, lane, t)).join('')).join('');

/**
 * The page for `traces`, one or two built traces (`buildTrace`). With two, the lanes sit side by side and line up by
 * step number. Returns the whole HTML text: one file, its own CSS and script, no outside requests.
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
<div class="lanes">${traces.map(lanePanel).join('')}</div>
${mismatchBanner(traces)}
${legend()}
<div class="work">
<div class="panel scroll"><table>${header(traces)}<tbody>${stepRows(traces)}${endRow(traces)}</tbody></table></div>
<aside class="panel drawer" aria-live="polite"><p class="eyebrow">detail</p><div id="drawer-body"><p class="na">Select a call.</p></div></aside>
</div>
</main>
<div hidden>${details(traces)}</div>
<script>${read('client.js')}</script>
</body>
</html>
`;
}

module.exports = { renderPage };
