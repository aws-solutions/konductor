// SPDX-License-Identifier: Apache-2.0
/**
 * Secret check of the text a subject run returns. The file sweep (sweep.js) reads what is stored: the raw event log,
 * where every string is JSON-encoded and cut into the events and blocks the CLI wrote. The trace reader (claude-trace.js)
 * builds strings the file does not hold whole: the answer joined from several assistant text blocks, a tool result
 * joined from its blocks. A value printed in pieces across two turns is in no contiguous run of the file, but it is
 * in the joined string a judge would read. The same holds for a JSON escape the CLI wrote for a character of the
 * value. So every string of the trace record is checked here with the stop tier of classifySecrets (redact.js): the
 * exact values handed to the child and the canary. Other secret-shaped text is not reported here; the file sweep
 * warns about it and the redactor replaces it before a judge sees it. The process's stderr is not part of the
 * trace: the runner returns it redacted and nothing judges it.
 *
 * Each field of the record is scanned as one string: a nested value (a tool result that is a list of blocks, the
 * arguments of a call) is joined with nothing between its strings, so a value split across blocks is found. A field is
 * never joined to another field.
 *
 * The result holds field names and counts, never the matching text.
 */
'use strict';

const { classifySecrets } = require('./redact');

const isObject = (value) => value !== null && typeof value === 'object';

/**
 * Every string inside `value`, in document order, joined with nothing between them. A string is returned as it is;
 * a number, a boolean and null hold no text. A content block (`{ type: 'text', text: '...' }`) counts as its `text`
 * alone, so the block's type tag does not sit between the pieces of a value split across blocks. Walks with its own
 * stack, so a deeply nested value cannot overflow the call stack.
 */
function flatText(value) {
  const parts = [];
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!isObject(item)) continue;
    if (typeof item.type === 'string' && typeof item.text === 'string') {
      parts.push(item.text);
      continue;
    }
    const children = Array.isArray(item) ? item : Object.values(item);
    for (let index = children.length - 1; index >= 0; index -= 1)
      pending.push(children[index]);
  }
  return parts.join('');
}

/**
 * The pieces of text to check: [{ source, text }]. `source` names the field of the trace record (`the answer text`
 * for `response_text`, `tool_calls[2] result` for the result of the third call).
 */
function traceTexts(trace) {
  const texts = [];
  for (const [key, value] of Object.entries(trace)) {
    if (key === 'tool_calls' && Array.isArray(value)) {
      value.forEach((call, index) => {
        for (const part of ['arguments', 'result'])
          texts.push({
            source: `tool_calls[${index}] ${part}`,
            text: flatText(call && call[part]),
          });
      });
    } else {
      texts.push({
        source: key === 'response_text' ? 'the answer text' : key,
        text: flatText(value),
      });
    }
  }
  return texts;
}

/**
 * Checks the text of `trace` for the values in `literals` and the canary.
 *   { clean, scanned, hits: [{ source, found }] }
 * `found` counts by pattern name (`literal`, `canary`). The raw log the trace was read from holds such a value in
 * pieces, which the file sweep cannot see, so the caller sets the log aside on a hit.
 */
function sweepTrace(trace, { literals = [] } = {}) {
  const texts = traceTexts(trace);
  const hits = [];
  for (const { source, text } of texts) {
    const { stop } = classifySecrets(text, literals);
    if (Object.keys(stop).length) hits.push({ source, found: stop });
  }
  return {
    clean: hits.length === 0,
    scanned: texts.length,
    hits,
  };
}

/**
 * The note for a run that must stop: what was found and where, without the values. '' when clean. `quarantined` is
 * the name the raw log was renamed to, when it was.
 */
function traceSecurityNote(result, { quarantined = null } = {}) {
  if (result.clean) return '';
  const parts = result.hits.map(
    (hit) =>
      `${hit.source} (${Object.entries(hit.found)
        .map(([name, count]) => `${name} x${count}`)
        .join(', ')})`,
  );
  return `SECURITY STOP: a value the run knows is secret (a credential handed to the child, or the canary) is in text the run returned: ${parts.join('; ')}.${quarantined ? ` The raw log is quarantined as ${quarantined}.` : ''} The matching text is not shown.`;
}

module.exports = { flatText, traceTexts, sweepTrace, traceSecurityNote };
