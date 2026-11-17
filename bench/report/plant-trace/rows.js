// SPDX-License-Identifier: Apache-2.0
'use strict';

// The table cells and the click-through detail of one step: five cells per step.

const { esc, pill, na, fmtMs, fmtInt, jsonBlock, oneLine, factList } = require('./html.js');

const KIND_LABEL = { allowed: ['allowed', 'ok'], blocked: ['blocked', 'warn'], unsafe: ['unsafe attempt ran', 'bad'] };

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

/** The decision cell: one pill for the row colour, then the gateway's reason and the unsafe rules the call carried. */
function decisionCell(step) {
  const [label, tone] = KIND_LABEL[step.kind];
  const shown = step.kind === 'blocked' ? `blocked: ${step.decision.replace('_', ' ')}` : label;
  const unsafe = step.unsafe.map((rule) => pill(rule, step.kind === 'blocked' ? 'warn' : 'bad', 'unsafe rule this call would break')).join(' ');
  const mismatch = step.gatewayOnly ? pill('no stream call', 'bad', 'the gateway saw this call but the agent stream has none that matches') : '';
  return `${pill(shown, tone)} ${unsafe} ${mismatch}${step.reason ? `<div class="args">${esc(step.reason)}</div>` : ''}`;
}

/** The tokens cell for `step` given the run's `tokens` facts; a label, never a zero, when the number is not known. */
function tokensCell(step, tokens) {
  if (tokens.mode === 'not-recorded') return na(tokens.note);
  if (tokens.mode === 'run-total') return na(`${tokens.note}; see the run summary`);
  if (!step.tokens) return na('no usage for this call in the stream');
  if (step.tokens.sameCall) return `<span class="na" title="same model call as the step above">same call</span>`;
  return `<span class="num" title="cache read ${esc(step.tokens.cacheRead)}, cache write ${esc(step.tokens.cacheWrite)}">${fmtInt(step.tokens.input)} in / ${fmtInt(step.tokens.output)} out</span>`;
}

/** The five cells of `step` of run number `lane` (its index on the page), as table cells. `trace` is that run's trace. */
function laneCells(step, lane, trace) {
  const id = `d-${lane}-${step.n}`;
  const cls = `k-${step.kind}`;
  const click = `data-d="${id}"`;
  return [
    `<td class="lead ${cls}" ${click} tabindex="0"><span class="tool">${esc(step.tool)}</span><div class="args">${esc(oneLine(step.args))}</div></td>`,
    `<td class="${cls}" ${click}>${decisionCell(step)}</td>`,
    `<td class="${cls} num" ${click} title="since the previous call: agent wait and gateway time">${fmtMs(step.stepMs)}</td>`,
    `<td class="${cls}" ${click}>${tokensCell(step, trace.tokens)}</td>`,
    `<td class="${cls}" ${click}>${stateStrip(step.stateAfter)}</td>`,
  ].join('');
}

function tokenRows(step, tokens) {
  if (tokens.mode === 'not-recorded') return [['tokens', esc(tokens.note)]];
  if (tokens.mode === 'run-total') return [['tokens', esc(`${tokens.note}`)]];
  const t = step.tokens;
  if (!t) return [['tokens', na('no usage for this call in the stream')]];
  if (t.sameCall) return [['tokens', 'same model call as an earlier step']];
  return [['tokens', `${fmtInt(t.input)} in, ${fmtInt(t.output)} out, cache read ${fmtInt(t.cacheRead)}, cache write ${fmtInt(t.cacheWrite)}`]];
}

const stateRows = (title, state) => (state ? [[title, esc(`speed ${state.speed_mmps}/${state.target_mmps} mm/s, guard ${state.guard}, running ${state.running}, e-stop ${state.estop}, jam ${state.jammed}, person ${state.person_in_zone}`)]] : [[title, na()]]);

function eventRows(step) {
  const keep = step.events.filter((e) => ['approval_request', 'approval_update', 'fault', 'connection_lost', 'harm'].includes(e.type));
  return keep.map((e) => [e.type, esc(oneLine({ ...e, runId: undefined, seq: undefined, t_wall: undefined, state_after: undefined }, 160))]);
}

/** The hidden detail block for `step`: the call, its arguments, the gateway's decision and reason, times, plant state and the stream side. */
function stepDetail(step, lane, trace) {
  const stream = step.stream.matched
    ? [['stream call', esc(step.stream.toolCallId)]]
    : [['stream call', pill('none matches', 'bad', 'no stream call has this tool and args_sha256')]];
  const rows = [
    ['decision', esc(step.decision)], ['reason', step.reason ? esc(step.reason) : na('the gateway gave none')],
    ['unsafe rules', step.unsafe.length ? esc(step.unsafe.join(', ')) : 'none'], ['harm', step.harm.length ? esc(step.harm.join(', ')) : 'none'],
    ['needs approval', esc(step.needsApproval)], ['stale sensors', step.staleSensors.length ? esc(step.staleSensors.join(', ')) : 'none'],
    ['agent wait', fmtMs(step.waitMs)], ['gateway time', fmtMs(step.gatewayMs)], ['sim time moved', fmtMs(step.simMs)],
    ...stateRows('plant before', step.stateBefore), ...stateRows('plant after', step.stateAfter),
    ...tokenRows(step, trace.tokens), ...stream, ...eventRows(step), ['args sha256', esc(step.argsSha256)],
  ];
  const saw = step.stream.resultText ? `<h4>agent saw</h4><pre>${esc(step.stream.resultText)}</pre>` : '';
  return `<div hidden id="d-${lane}-${step.n}"><h3>${esc(trace.label)}: step ${step.n}, ${esc(step.tool)}</h3><h4>arguments</h4>${jsonBlock(step.args)}<h4>gateway</h4>${factList(rows)}${saw}</div>`;
}

module.exports = { laneCells, stepDetail, stateStrip };
