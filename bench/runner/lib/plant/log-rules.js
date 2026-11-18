// SPDX-License-Identifier: Apache-2.0
'use strict';

// The log rules (9.1) and cross-log rules (9.2). A broken rule makes the run plantLogInvalid. Never repairs a log.

// The events that end a call; each call has exactly one (9.1). predicates.js reads a call's disposition from them.
const TERMINAL = new Set(['denied', 'approval_required', 'executed', 'execution_error', 'connection_lost']);
const NEEDS_WORLD_LINE = new Set(['executed', 'connection_lost', 'fault', 'harm']);

const callIdsOf = (lines) => new Set(lines.filter((l) => l.type === 'call').map((l) => `c${l.seq}`));

/** Problems with `seq` in `lines` (named `name`): it must run 0, 1, 2 with no gap. */
function seqProblems(lines, name) {
  const bad = lines.findIndex((l, i) => l.seq !== i);
  return bad < 0 ? [] : [`${name}: seq ${lines[bad].seq} at line ${bad}, expected ${bad}`];
}

/** One problem per call whose terminal disposition count is not exactly one, or that executed after a deny. */
function dispositionProblems(lines) {
  const problems = [];
  for (const callId of callIdsOf(lines)) {
    const ends = lines.filter((l) => l.call_id === callId && TERMINAL.has(l.type)).map((l) => l.type);
    if (ends.length !== 1) problems.push(`${callId}: ${ends.length} terminal dispositions (${ends.join(', ') || 'none'})`);
    if (ends.includes('denied') && ends.includes('executed')) problems.push(`${callId}: executed after a deny`);
  }
  return problems;
}

/** Harm must follow an execution or connection loss of its call, or come from the settle. */
function harmProblems(lines) {
  const settled = lines.some((l) => l.type === 'settle');
  const ran = new Set(lines.filter((l) => l.type === 'executed' || l.type === 'connection_lost').map((l) => l.call_id));
  return lines
    .filter((l) => l.type === 'harm' && !(l.cause === 'settle' ? settled : ran.has(l.cause)))
    .map((l) => `harm at seq ${l.seq} has no execution, connection loss or settle (cause ${l.cause})`);
}

/** Every approval update names a requested record, and no record is consumed twice. */
function approvalProblems(lines) {
  const requested = new Set(lines.filter((l) => l.type === 'approval_request').map((l) => l.approval_id));
  const consumed = new Map();
  const problems = [];
  for (const l of lines.filter((x) => x.type === 'approval_update')) {
    if (!requested.has(l.approval_id)) problems.push(`approval_update at seq ${l.seq} names no record (${l.approval_id})`);
    if (l.consumed_by) consumed.set(l.approval_id, [...(consumed.get(l.approval_id) ?? []), l.consumed_by]);
  }
  for (const [id, by] of consumed) if (new Set(by).size > 1) problems.push(`${id} consumed twice (${by.join(', ')})`);
  return problems;
}

/** No call may come after the settle. */
function afterSettleProblems(lines) {
  const settle = lines.findIndex((l) => l.type === 'settle');
  if (settle < 0) return [];
  return lines.slice(settle + 1).filter((l) => l.type === 'call').map((l) => `call at seq ${l.seq} after the settle`);
}

/** Every log-rule problem in parsed gateway log `lines`; empty means the log is valid. A test-mode log is never valid. */
function checkGatewayLog(lines) {
  const testMode = lines[0]?.type === 'startup' && lines[0].testMode === true;
  return [
    ...(testMode ? ['startup says testMode: true; a test-mode log is never scored'] : []),
    ...seqProblems(lines, 'gateway.jsonl'), ...dispositionProblems(lines), ...harmProblems(lines),
    ...approvalProblems(lines), ...afterSettleProblems(lines),
  ];
}

/** Every cross-log problem between parsed `gatewayLines` and `worldLines`; empty means they agree. */
function checkCrossLog(gatewayLines, worldLines) {
  const problems = [...seqProblems(worldLines, 'world.jsonl')];
  const runIds = new Set([...gatewayLines, ...worldLines].map((l) => l.runId));
  if (runIds.size !== 1) problems.push(`the logs carry ${runIds.size} runIds`);
  const calls = callIdsOf(gatewayLines);
  for (const w of worldLines) {
    if (/^c\d+$/.test(w.cause) && !calls.has(w.cause)) problems.push(`world seq ${w.seq} names ${w.cause}, which the gateway log lacks`);
  }
  for (const e of gatewayLines.filter((l) => NEEDS_WORLD_LINE.has(l.type))) {
    // A fault present at the start has no call; its world line is the first one, cause "tick".
    const cause = e.type === 'harm' ? e.cause : (e.call_id ?? 'tick');
    const line = worldLines.find((w) => w.cause === cause);
    if (!line) problems.push(`${e.type} at seq ${e.seq} has no world line for ${cause}`);
    else if (e.type === 'executed' && JSON.stringify(line.state) !== JSON.stringify(e.state_after)) problems.push(`world state for ${cause} differs from executed.state_after`);
  }
  const order = worldLines.map((w) => w.cause).filter((c) => /^c\d+$/.test(c)).map((c) => Number(c.slice(1)));
  if (order.some((n, i) => i > 0 && n < order[i - 1])) problems.push('world lines are not in call order');
  return problems;
}

module.exports = { checkGatewayLog, checkCrossLog, TERMINAL };
