// SPDX-License-Identifier: Apache-2.0
/**
 * Reader for a Claude Code `--output-format stream-json` trace: newline-delimited JSON events.
 *
 *   system/init  the tools Claude Code actually loaded for the session (`tools`), read as `available_tools`, and
 *                the CLI version (`claude_code_version`), read as `cli_version` (null when the event has none).
 *   assistant    the model's turns. Each content block is either text or a tool_use (a tool call). A tool_use of
 *                the `Skill` tool is how a skill load shows: Claude Code has a dedicated tool for it.
 *   user         tool results arrive inside a later `user` event's content array, each a tool_result block that
 *                carries the `tool_use_id` it answers. That pairs a result with its call, and `is_error` gives the
 *                call's status.
 *   result       the terminal event: the final answer (`result`), aggregate usage and cost, `is_error`, the
 *                models that produced output (`modelUsage`, read as `models_used`) and the calls the permission
 *                mode refused (`permission_denials`).
 *   error        an error the CLI reports.
 *
 * The answer is the text of the result event, and only that: a result event with an empty `result` has an empty
 * answer, so earlier narration is never read as the final reply. Only a log with no result event (a run cut off
 * before it ended) falls back to the assistant text blocks joined in order, and `result_seen` is false for it, so a
 * caller can tell. A line that is not JSON is skipped. A tool result that names no known call is ignored.
 *
 * Returned record:
 *   { runtime: 'claude-code', session_id, cli_version, model_id, available_tools: string[] | null, models_used: string[],
 *     tool_calls: [{ tool_name, raw_tool_name, arguments, status, result }], response_text,
 *     usage: { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens } | null, cost_usd,
 *     result_seen, result_is_error, permission_denials: string[], errors: [{ message, raw }] }
 *
 * `available_tools` is null when the trace has no init event, so a caller never mistakes a missing list for an
 * empty one. `usage` is null when the result event has no usage object; its fields are null for a count it does not
 * carry: a caller must not read either as zero. A call's `status` is `completed`, `error`, or `unknown` while no
 * result names it.
 */
'use strict';

const { normalizeToolName } = require('./opencode-trace');

const isObject = (value) => value !== null && typeof value === 'object';
const tokenCount = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

function readClaudeCodeTrace(rawTrace) {
  const record = {
    runtime: 'claude-code',
    session_id: null,
    cli_version: null,
    model_id: null,
    available_tools: null,
    models_used: [],
    tool_calls: [],
    response_text: '',
    usage: null,
    cost_usd: null,
    result_seen: false,
    result_is_error: false,
    permission_denials: [],
    errors: [],
  };
  const lines = (
    Array.isArray(rawTrace) ? rawTrace : String(rawTrace ?? '').split('\n')
  ).filter(Boolean);
  // tool_use_id -> index into record.tool_calls, so a later tool_result can be matched to the call it answers.
  const callIndexById = new Map();
  let assistantText = '';

  for (const line of lines) {
    let event;
    try {
      event = typeof line === 'string' ? JSON.parse(line) : line;
    } catch {
      continue;
    }
    if (!isObject(event)) continue;

    if (event.type === 'system' && event.subtype === 'init') {
      if (Array.isArray(event.tools))
        record.available_tools = event.tools.map((tool) => String(tool));
      if (typeof event.session_id === 'string')
        record.session_id = event.session_id;
      if (
        typeof event.claude_code_version === 'string' &&
        event.claude_code_version
      )
        record.cli_version = event.claude_code_version;
      continue;
    }

    const content =
      isObject(event.message) && Array.isArray(event.message.content)
        ? event.message.content
        : null;

    if (event.type === 'assistant' && content) {
      if (typeof event.message.model === 'string' && event.message.model)
        record.model_id = event.message.model;
      for (const block of content) {
        if (!isObject(block)) continue;
        if (block.type === 'tool_use') {
          const rawName = String(block.name ?? '');
          record.tool_calls.push({
            tool_name: normalizeToolName(rawName),
            raw_tool_name: rawName,
            arguments: isObject(block.input) ? block.input : {},
            status: 'unknown',
            result: null,
          });
          if (typeof block.id === 'string')
            callIndexById.set(block.id, record.tool_calls.length - 1);
        } else if (block.type === 'text' && typeof block.text === 'string') {
          assistantText += block.text;
        }
      }
    } else if (event.type === 'user' && content) {
      for (const block of content) {
        if (!isObject(block) || block.type !== 'tool_result') continue;
        const index = callIndexById.get(block.tool_use_id);
        if (index === undefined) continue;
        record.tool_calls[index].status = block.is_error
          ? 'error'
          : 'completed';
        record.tool_calls[index].result = block.content ?? null;
        if (block.is_error)
          record.errors.push({
            message: `tool_use_id ${block.tool_use_id} returned an error`,
            raw: block.content,
          });
      }
    } else if (event.type === 'result') {
      record.result_seen = true;
      record.response_text =
        typeof event.result === 'string' ? event.result : '';
      if (typeof event.model === 'string' && event.model)
        record.model_id = event.model;
      if (isObject(event.usage))
        record.usage = {
          input_tokens: tokenCount(event.usage.input_tokens),
          output_tokens: tokenCount(event.usage.output_tokens),
          cache_read_tokens: tokenCount(event.usage.cache_read_input_tokens),
          cache_write_tokens: tokenCount(
            event.usage.cache_creation_input_tokens,
          ),
        };
      if (
        typeof event.total_cost_usd === 'number' &&
        Number.isFinite(event.total_cost_usd)
      )
        record.cost_usd = event.total_cost_usd;
      if (isObject(event.modelUsage))
        record.models_used = Object.keys(event.modelUsage);
      if (Array.isArray(event.permission_denials))
        record.permission_denials = event.permission_denials.map((denial) =>
          String((isObject(denial) && denial.tool_name) || '?'),
        );
      if (event.is_error) {
        record.result_is_error = true;
        record.errors.push({
          message:
            (typeof event.result === 'string' && event.result) ||
            'claude code reported is_error on the result event',
          raw: event,
        });
      }
    } else if (event.type === 'error') {
      const message =
        (typeof event.message === 'string' && event.message) ||
        (typeof event.error === 'string' && event.error) ||
        'claude code error event';
      record.errors.push({ message, raw: event });
    }
  }

  if (!record.result_seen) record.response_text = assistantText;
  return record;
}

module.exports = { readClaudeCodeTrace };
