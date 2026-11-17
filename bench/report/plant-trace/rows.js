// SPDX-License-Identifier: Apache-2.0
'use strict';

// The HTML of the step tree. Each call is a native <details>: its <summary> is the one-line view, its body the core
// stats. A child agent is a <details> holding its own calls, indented. The long extras sit in a hidden block per call,
// which the "more" button copies into the side panel. Reads only the JSON from `buildTrace`.

const { esc, pill, na, fmtMs, fmtInt, jsonBlock, oneLine, factList } = require('./html.js');

const KIND_LABEL = { allowed: ['allowed', 'ok'], blocked: ['blocked', 'warn'], unsafe: ['unsafe attempt ran', 'bad'] };
const MAX_RAW = 6000;

/** The plant state as a strip: a speed bar and chips for what is not normal (guard open, e-stop, jam, a person in the zone). */
function stateStrip(state) {
  if (!state) return na('the simulator log has no state for this step');
  const max = state.rated_max_mmps > 0 ? state.rated_max_mmps : 1;
  const width = Math.max(0, Math.min(100, Math.round((100 * state.speed_mmps) / max)));
  const chips = [
    pill(`guard ${state.guard}`, state.guard === 'open' ? 'warn' : ''),
    state.estop ? pill('e-stop', 'bad') : '',
    state.jammed ? pill('jam', 'warn') : '',
    state.person_in_zone ? pill('person in zone', 'bad') : '',
    state.running ? '' : pill('stopped'),
  ].join('');
  return `<div class="strip"><span class="speed" title="speed against rated max"><i style="width:${width}%"></i></span><span class="num">${esc(state.speed_mmps)}/${esc(state.target_mmps)} mm/s</span>${chips}</div>`;
}

/** The decision pill of `step`, coloured by its kind. */
function decisionPill(step) {
  const [label, tone] = KIND_LABEL[step.kind];
  return pill(step.kind === 'blocked' ? `blocked: ${step.decision.replace('_', ' ')}` : label, tone);
}

/** The tokens of `step` given the run's `tokens` facts; a label, never a zero, when the number is not known. */
function tokensText(step, tokens) {
  if (tokens.mode === 'not-recorded') return na(tokens.note);
  if (tokens.mode === 'run-total') return na(`${tokens.note}; see the run summary`);
  if (!step.tokens) return na('no usage for this call in the stream');
  if (step.tokens.sameCall) return `<span class="na" title="same model call as the step above">same call</span>`;
  return `<span class="num" title="cache read ${esc(step.tokens.cacheRead)}, cache write ${esc(step.tokens.cacheWrite)}">${fmtInt(step.tokens.input)} in / ${fmtInt(step.tokens.output)} out</span>`;
}

function matchText(step) {
  if (step.stream.matched) return pill('stream call matches', 'ok', `stream call ${step.stream.toolCallId}`);
  return pill('no stream call matches', 'bad', 'the gateway saw this call but no stream call has this tool and args_sha256');
}

/** The core stats shown when a call is open: arguments, decision and reason, unsafe rules, plant after, match. */
function coreStats(step, id) {
  const rows = [
    ['args', `<span class="mono">${esc(oneLine(step.args, 160))}</span>`],
    ['gateway', `${decisionPill(step)} ${step.reason ? esc(step.reason) : na('the gateway gave no reason')}`],
    ['unsafe rules', step.unsafe.length ? step.unsafe.map((r) => pill(r, step.kind === 'blocked' ? 'warn' : 'bad')).join(' ') : 'none'],
    ['harm', step.harm.length ? esc(step.harm.join(', ')) : 'none'],
    ['plant after', stateStrip(step.stateAfter)],
    ['stream', matchText(step)],
  ];
  return `<div class="core">${factList(rows)}<button type="button" class="more" data-d="${id}">more</button></div>`;
}

/** The one-line summary of a call: arrow, step number, tool, decision colour, time, tokens. */
function callSummary(step, tokens) {
  const flag = step.gatewayOnly ? ` ${pill('no stream call', 'bad')}` : '';
  return `<summary><span class="n num">${esc(step.n)}</span><span class="tool">${esc(step.tool)}</span><span class="dec">${decisionPill(step)}${flag}</span><span class="t num" title="since the previous call: agent wait and gateway time">${fmtMs(step.stepMs)}</span><span class="tok">${tokensText(step, tokens)}</span></summary>`;
}

const detailId = (lane, step) => `d-${lane}-${step.n}`;

/** One call node as a closed <details>. `lane` is the run's index on the page; `trace` is that run's JSON. */
const callNode = (step, lane, trace) => `<details class="step k-${esc(step.kind)}">${callSummary(step, trace.tokens)}${coreStats(step, detailId(lane, step))}</details>`;

/** One child agent node, open, with its calls and child agents under it. */
function agentNode(node, lane, trace) {
  const count = `${node.stepCount} ${node.stepCount === 1 ? 'step' : 'steps'}`;
  return `<details class="agent" open><summary><span class="agent-name">${pill('agent', 'vi')} ${esc(node.name)}</span><span class="na">${esc(count)}</span></summary><div class="kids">${treeHtml(node.children, lane, trace)}</div></details>`;
}

/** The HTML of a list of step nodes, at any depth. */
function treeHtml(nodes, lane, trace) {
  return nodes.map((n) => (n.type === 'agent' ? agentNode(n, lane, trace) : callNode(n, lane, trace))).join('');
}

function tokenRows(step, tokens) {
  if (tokens.mode !== 'per-step') return [['tokens', esc(tokens.note)]];
  const t = step.tokens;
  if (!t) return [['tokens', na('no usage for this call in the stream')]];
  if (t.sameCall) return [['tokens', 'same model call as an earlier step']];
  return [['tokens', `${fmtInt(t.input)} in, ${fmtInt(t.output)} out, cache read ${fmtInt(t.cacheRead)}, cache write ${fmtInt(t.cacheWrite)}`]];
}

const stateRows = (title, state) => (state ? [[title, esc(`speed ${state.speed_mmps}/${state.target_mmps} mm/s, guard ${state.guard}, running ${state.running}, e-stop ${state.estop}, jam ${state.jammed}, person ${state.person_in_zone}`)]] : [[title, na()]]);

function rawBlock(value) {
  const text = JSON.stringify(value ?? null, null, 2) ?? 'null';
  return `<pre>${esc(text.length > MAX_RAW ? `${text.slice(0, MAX_RAW)}\n... [cut]` : text)}</pre>`;
}

/** The hidden extras of one call: full arguments, timings, the raw stream event and the raw gateway record. */
function stepExtras(step, lane, trace) {
  const rows = [
    ['needs approval', esc(step.needsApproval)], ['stale sensors', step.staleSensors.length ? esc(step.staleSensors.join(', ')) : 'none'],
    ['agent wait', fmtMs(step.waitMs)], ['gateway time', fmtMs(step.gatewayMs)], ['sim time moved', fmtMs(step.simMs)],
    ...stateRows('plant before', step.stateBefore), ...tokenRows(step, trace.tokens),
    ['stream call', step.stream.matched ? esc(step.stream.toolCallId) : na('none matches')], ['args sha256', esc(step.argsSha256)],
  ];
  const saw = step.stream.resultText ? `<h4>agent saw</h4><pre>${esc(step.stream.resultText)}</pre>` : '';
  const stream = step.stream.matched ? rawBlock(step.stream.raw) : `<p class="na">no stream event matches this call</p>`;
  const gateway = rawBlock([step.gatewayRecord, ...step.events]);
  return `<div hidden id="${detailId(lane, step)}"><h3>${esc(trace.label)}: step ${esc(step.n)}, ${esc(step.tool)}</h3><h4>arguments</h4>${jsonBlock(step.args)}<h4>more facts</h4>${factList(rows)}${saw}<h4>raw stream event</h4>${stream}<h4>raw gateway record</h4>${gateway}</div>`;
}

module.exports = { treeHtml, stepExtras, stateStrip };
