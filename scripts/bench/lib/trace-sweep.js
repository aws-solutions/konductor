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
 *
 * redactTraceLog makes the quarantined copy of a raw log: the same joined strings are read again, and the pieces of a
 * value that sweepTrace found are cut from the strings that hold them.
 */
'use strict';

const {
  RULES,
  checkLiterals,
  classifySecrets,
  createRedactor,
} = require('./redact');

const isObject = (value) => value !== null && typeof value === 'object';
const REDACTED = '[REDACTED]';
const CANARY_PATTERN = RULES.find((rule) => rule.name === 'canary').pattern;

/**
 * The strings inside `value`, in document order, as [holder, key] pairs: `holder[key]` is the string, so a caller can
 * read it or replace it. A top-level string is returned as a pair too (its holder is a wrapper object). With
 * `blocksAsText` (the default), a content block (`{ type: 'text', text: '...' }`) counts as its `text` alone, so
 * the block's type tag does not sit between the pieces of a value split across blocks; without it every string is
 * listed. Walks with its own stack, so a deeply nested value cannot overflow the call stack.
 */
function stringRefs(value, { blocksAsText = true } = {}) {
  const refs = [];
  const pending = [[{ value }, 'value']];
  while (pending.length) {
    const [holder, key] = pending.pop();
    const item = holder[key];
    if (typeof item === 'string') {
      refs.push([holder, key]);
      continue;
    }
    if (!isObject(item)) continue;
    if (
      blocksAsText &&
      typeof item.type === 'string' &&
      typeof item.text === 'string'
    ) {
      refs.push([item, 'text']);
      continue;
    }
    const keys = Object.keys(item);
    for (let index = keys.length - 1; index >= 0; index -= 1)
      pending.push([item, keys[index]]);
  }
  return refs;
}

/**
 * Every string inside `value`, in document order, joined with nothing between them. A string is returned as it is;
 * a number, a boolean and null hold no text. A content block counts as its `text` alone (see stringRefs).
 */
const flatText = (value) =>
  stringRefs(value)
    .map(([holder, key]) => holder[key])
    .join('');

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
 * the name the raw log was set aside as, when it was. `quarantineFailed` is true when it could not be: the raw log
 * is still in the run folder.
 */
function traceSecurityNote(
  result,
  { quarantined = null, quarantineFailed = false } = {},
) {
  if (result.clean) return '';
  const parts = result.hits.map(
    (hit) =>
      `${hit.source} (${Object.entries(hit.found)
        .map(([name, count]) => `${name} x${count}`)
        .join(', ')})`,
  );
  const fate = quarantined
    ? ` The raw log is quarantined as ${quarantined}.`
    : quarantineFailed
      ? ' The raw log could not be quarantined and is still in the run folder.'
      : '';
  return `SECURITY STOP: a value the run knows is secret (a credential handed to the child, or the canary) is in text the run returned: ${parts.join('; ')}.${fate} The matching text is not shown.`;
}

/** [from, to) of every occurrence of a stop value in `text`: the exact `literals` and the canary, merged where they overlap. */
function stopRanges(text, literals) {
  const found = [];
  for (const literal of literals)
    for (
      let at = text.indexOf(literal);
      at !== -1;
      at = text.indexOf(literal, at + 1)
    )
      found.push([at, at + literal.length]);
  for (const match of text.matchAll(CANARY_PATTERN))
    found.push([match.index, match.index + match[0].length]);
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/**
 * Removes the stop values from the strings of `refs` (stringRefs pairs) read as one joined text, in place: the
 * characters of a value are cut from each string that holds a piece of it, and the first of those strings gets the
 * marker. A value inside one string is the redactor's job, not this one's.
 */
function redactJoined(refs, literals) {
  if (refs.length < 2) return;
  const texts = refs.map(([holder, key]) => holder[key]);
  const joined = texts.join('');
  const ranges = stopRanges(joined, literals);
  if (!ranges.length) return;
  let start = 0;
  refs.forEach(([holder, key], index) => {
    const end = start + texts[index].length;
    let redacted = '';
    let cursor = start;
    for (const [from, to] of ranges) {
      if (to <= start || from >= end) continue;
      redacted += joined.slice(cursor, Math.max(from, start));
      if (from >= start) redacted += REDACTED;
      cursor = Math.min(to, end);
    }
    holder[key] = redacted + joined.slice(cursor, end);
    start = end;
  });
}

/** The text sequences of one parsed event that sweepTrace reads as one string, as stringRefs lists. */
function eventSequences(event) {
  const sequences = [stringRefs(event)];
  const content =
    isObject(event.message) && Array.isArray(event.message.content)
      ? event.message.content
      : [];
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === 'tool_use') sequences.push(stringRefs(block.input));
    else if (block.type === 'tool_result')
      sequences.push(stringRefs(block.content));
  }
  // The trace record lists the tool names of a result event's permission denials as one field. In the event the
  // strings between them (the call ids, the call inputs) keep the pieces of a value apart, so they are read as a
  // sequence of their own.
  if (event.type === 'result' && Array.isArray(event.permission_denials))
    sequences.push(
      event.permission_denials
        .filter(
          (denial) => isObject(denial) && typeof denial.tool_name === 'string',
        )
        .map((denial) => [denial, 'tool_name']),
    );
  return sequences;
}

/**
 * A copy of a raw event log (newline-delimited JSON) with the stop values removed, for quarantine. Whole values are
 * replaced in every string of every event, as the redactor does. A value printed in pieces is in no one string, so the
 * strings that sweepTrace joins are also read as one text each, and the pieces are cut from them: the assistant text
 * blocks of the whole log in order, the strings of each event, the input of each tool call, the content of each tool
 * result and the tool names of a result event's permission denials. The matching secret shapes are the caller's to replace in the returned text (createRedactor).
 *
 * A line that is not a JSON object is returned as it is; the trace reader skips it too. A line that parses but cannot
 * be written again (nested too deep) becomes a marker line, so no value in it survives.
 */
function redactTraceLog(rawLog, { literals = [] } = {}) {
  const exactLiterals = checkLiterals(literals);
  const redact = createRedactor({
    literals: exactLiterals,
    maxChars: Infinity,
  });
  const lines = String(rawLog).split('\n');
  const events = lines.map((line) => {
    try {
      const parsed = JSON.parse(line);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
  const assistantText = [];
  events.forEach((event) => {
    if (!event) return;
    for (const [holder, key] of stringRefs(event, { blocksAsText: false }))
      holder[key] = redact(holder[key]);
    if (event.type === 'assistant' && isObject(event.message)) {
      const content = Array.isArray(event.message.content)
        ? event.message.content
        : [];
      for (const block of content)
        if (
          isObject(block) &&
          block.type === 'text' &&
          typeof block.text === 'string'
        )
          assistantText.push([block, 'text']);
    }
  });
  redactJoined(assistantText, exactLiterals);
  for (const event of events)
    if (event)
      for (const refs of eventSequences(event))
        redactJoined(refs, exactLiterals);
  return lines
    .map((line, index) => {
      if (!events[index]) return line;
      try {
        return JSON.stringify(events[index]);
      } catch {
        return '[REDACTED: a line of the log could not be written again]';
      }
    })
    .join('\n');
}

module.exports = {
  flatText,
  stringRefs,
  traceTexts,
  sweepTrace,
  traceSecurityNote,
  redactTraceLog,
};
