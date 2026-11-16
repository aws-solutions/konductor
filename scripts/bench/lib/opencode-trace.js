// SPDX-License-Identifier: Apache-2.0
/**
 * Reader for an OpenCode `run --format json` trace: newline-delimited JSON events.
 *
 *   step_start   a turn boundary: a model step began. `step_started` says whether one did.
 *   tool_use     a tool call and its result fused into one event. `part.state.status` is the
 *                authoritative signal: anything other than "completed" is recorded as an error, so an
 *                in-flight or failed state never reads as a finished call.
 *   step_finish  usage and cost of one turn. Usage and cost are summed over every step_finish event.
 *   text         an assistant output chunk. The last one is the final answer. It is kept as the raw string,
 *                including any markdown fence: reading the fence is the judge-scale parser's job.
 *   error        an error the CLI reports.
 *
 * There is no terminal event that carries both the answer and the usage totals, and no session-init event
 * that lists the tools that were loaded, so `available_tools` is never inferred from the tools that happened
 * to be used. A line that is not JSON is skipped.
 *
 * Returned record:
 *   { runtime: 'opencode', session_id, tool_calls: [{ tool_name, raw_tool_name, arguments, status, result }],
 *     response_text, usage: { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens } | null,
 *     cost_usd: number | null, finish_reason: string | null, errors: [{ message, raw }], step_started: boolean }
 *
 * `finish_reason` is the `reason` of the last step_finish event (`stop`, `length`, `tool-calls`, ...), null when the
 * trace has none: `length` means the model stopped at its output limit, so the reply is cut off.
 *
 * `usage` is null when the trace had no step_finish event: some models emit none, and a caller must then
 * find the usage elsewhere instead of reading it as zero. `step_started` is true when the trace shows a model
 * step (a step_start, step_finish, text or tool_use event); false means the call ended before any model step, for
 * example on a flag or a config the CLI refused.
 */
'use strict';

/**
 * A tool name down to its base identifier: `mcp__<server>__<tool>` and `plugin:server:tool__subtool`
 * collapse to the tool, lowercased.
 */
function normalizeToolName(name) {
  if (!name) return '';
  if (name.includes(':')) {
    const toolPart = name.slice(name.lastIndexOf(':') + 1);
    const separator = toolPart.lastIndexOf('__');
    return (
      separator > 0 ? toolPart.slice(separator + 2) : toolPart
    ).toLowerCase();
  }
  const separator = name.lastIndexOf('__');
  if (separator > 0 && name.startsWith('mcp__'))
    return name.slice(separator + 2).toLowerCase();
  return name.toLowerCase();
}

const isObject = (value) => value !== null && typeof value === 'object';
// Events that only a model step emits.
const STEP_EVENTS = new Set(['step_start', 'step_finish', 'text', 'tool_use']);
const tokenCount = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

function readOpenCodeTrace(rawTrace) {
  const record = {
    runtime: 'opencode',
    session_id: null,
    tool_calls: [],
    response_text: '',
    usage: null,
    cost_usd: null,
    finish_reason: null,
    errors: [],
    step_started: false,
  };
  const lines = (
    Array.isArray(rawTrace) ? rawTrace : String(rawTrace ?? '').split('\n')
  ).filter(Boolean);
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  let sawStepFinish = false;
  let lastText = null;

  for (const line of lines) {
    let event;
    try {
      event = typeof line === 'string' ? JSON.parse(line) : line;
    } catch {
      continue;
    }
    if (!isObject(event)) continue;
    if (record.session_id === null && typeof event.sessionID === 'string')
      record.session_id = event.sessionID;
    const part = isObject(event.part) ? event.part : null;
    if (STEP_EVENTS.has(event.type)) record.step_started = true;

    if (event.type === 'tool_use' && part) {
      const rawName = String(part.tool ?? '');
      const state = isObject(part.state) ? part.state : {};
      const completed = state.status === 'completed';
      record.tool_calls.push({
        tool_name: normalizeToolName(rawName),
        raw_tool_name: rawName,
        arguments: isObject(state.input) ? state.input : {},
        status: completed ? 'completed' : 'error',
        result: state.output ?? null,
      });
      if (!completed)
        record.errors.push({
          message: `opencode tool "${rawName}" did not complete`,
          raw: part,
        });
    } else if (event.type === 'step_finish' && part) {
      sawStepFinish = true;
      if (typeof part.reason === 'string' && part.reason)
        record.finish_reason = part.reason;
      if (typeof part.cost === 'number' && Number.isFinite(part.cost))
        record.cost_usd = (record.cost_usd || 0) + part.cost;
      const tokens = isObject(part.tokens) ? part.tokens : {};
      const cache = isObject(tokens.cache) ? tokens.cache : {};
      usage.input_tokens += tokenCount(tokens.input);
      // Reasoning tokens are billed as output.
      usage.output_tokens +=
        tokenCount(tokens.output) + tokenCount(tokens.reasoning);
      usage.cache_read_tokens += tokenCount(cache.read);
      usage.cache_write_tokens += tokenCount(cache.write);
    } else if (event.type === 'text' && part) {
      lastText = typeof part.text === 'string' ? part.text : '';
    } else if (event.type === 'error') {
      const error = isObject(event.error) ? event.error : null;
      // Newer OpenCode versions put the text in error.data.message and the class in error.name.
      const nested =
        error && isObject(error.data) && typeof error.data.message === 'string'
          ? error.data.message
          : '';
      const name =
        error && typeof error.name === 'string' && error.name ? error.name : '';
      record.errors.push({
        message:
          (error && typeof error.message === 'string' && error.message) ||
          (nested && (name ? `${name}: ${nested}` : nested)) ||
          name ||
          'opencode error event',
        raw: error || event,
      });
    }
  }

  record.response_text = lastText || '';
  record.usage = sawStepFinish ? usage : null;
  return record;
}

module.exports = { normalizeToolName, readOpenCodeTrace };
