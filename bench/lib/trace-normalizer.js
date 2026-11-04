// SPDX-License-Identifier: Apache-2.0
/**
 * Trace Normalizer
 *
 * Converts a raw agent-runtime trace from any of the three supported CLIs (Claude Code,
 * OpenCode, Kiro CLI) into one session-record schema. This module parses already-captured
 * text or JSON. It is pure and dependency-free: it does no I/O, makes no network or model
 * calls and spawns no processes.
 *
 * Stable API: `normalizeTrace`, `defaultRedact` and `SCHEMA_VERSION`. The other exports are
 * helpers and limits exposed for tests and may change without notice.
 *
 * Input: a string of newline-delimited JSON events, an array of strings that each hold one or
 * more newline-delimited JSON events (for example stdout `data` chunks collected as they arrive),
 * or an array of already-parsed event objects. An array may mix strings and parsed events. Every
 * string element is split on newlines, so a chunk holding several events is read event by event.
 * The `line` number in an `errors` entry counts the events and lines after that split, from 1.
 * Bad input never throws.
 *  - A line that is not valid JSON, or an event (parsed from a line or passed in pre-parsed) that
 *    is null or not a plain object, is counted in `parse_errors` only. It adds no `errors` entry,
 *    in particular no `malformed_event`.
 *  - An object event with an unusable shape adds one `malformed_event` entry to `errors` and is
 *    skipped.
 *  - A tool call whose name is missing, null, an object, an array or an empty string is recorded
 *    with `tool_name` and `raw_tool_name` set to 'unknown' and adds one `invalid_tool_name` entry
 *    to `errors`. A number or boolean name is converted to its string form and adds no entry.
 * Only an unknown runtime name throws, because that is a caller bug, not bad data.
 *
 * Verification status. Which input formats have been checked against a real capture:
 *  - Claude Code: verified against a captured `claude` 2.1.318 `--output-format stream-json
 *    --verbose` run (fixtures/traces/claude-code-2.1.318-read.jsonl).
 *  - Kiro CLI: the ACP envelope (`type: 'sessionUpdate'`, `data.update.sessionUpdate`) is verified
 *    against captured `kiro-cli` 3.0.0 `chat --output-format stream-json` runs
 *    (fixtures/traces/kiro-cli-3.0.0-*.jsonl). The older flat shape (`type: 'tool_call'` with
 *    `tool_call_id`, `tool_name`, `arguments`, string `content`, and a `model` event) is NOT known to
 *    be emitted by any release: it was written from an assumed format, and it is kept only so the
 *    synthetic behavior fixtures keep working. Treat it as unverified.
 *  - OpenCode: UNVERIFIED. No tool-call run could be captured (the installed 2.0.27 had no
 *    authenticated provider), so the parser still reflects the documented event shapes only.
 * A fixture is a real capture only when its file name carries the CLI name and version; the others
 * under fixtures/traces/ are synthetic.
 *
 * Record schema (schema_version 1; fields added later stay additive and do not bump it.
 * `tool_calls[].tool_call_id` and `unrecognized_events` were added this way):
 *   {
 *     schema_version: 1,
 *     runtime: 'claude-code' | 'opencode' | 'kiro',
 *     model_id: string | null,         // as the trace reports it, redacted and capped
 *     session_ids: string[],           // OpenCode and Kiro (ACP): every session id seen. Empty for Claude Code.
 *     tool_calls: [
 *       {
 *         tool_call_id: string | null, // the id the runtime reported for the call (see "Tool call ids")
 *         tool_name: string,           // normalized (see normalizeToolName); 'unknown' if unusable
 *         raw_tool_name: string,       // as reported; a number or boolean is stringified; redacted and capped
 *         arguments: object,           // redacted; string values and keys capped (see below)
 *         status: 'completed' | 'error' | 'unknown',   // see "Statuses" below
 *         result: unknown | null,      // redacted, string content capped; null if none reported
 *         truncated: boolean,          // true when arguments or result hit the size cap
 *         subagent: boolean,           // Claude Code: the event came from a subagent. Else false.
 *       },
 *     ],
 *     skill_loads: [
 *       {
 *         skill_name: string,
 *         source: 'dedicated-event' | 'path-heuristic',
 *         raw_path: string | null,
 *         subagent: boolean,
 *       },
 *     ],
 *     available_tools: string[] | 'unknown',
 *     response_text: string,           // redacted, never truncated
 *     usage: { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens } | null,
 *                                      // each value is a finite number >= 0, or null
 *     cost_usd: number | null,         // finite and >= 0, or null
 *     errors: [
 *       { type: string, message: string, line: number | null, raw: { event_type, line } },
 *     ],                               // raw never holds an event, only its type and line
 *     parse_errors: number,            // lines that were not a JSON object
 *     unrecognized_events: { [event_type: string]: number },
 *                                      // events the parser has no rule for, by type (see below)
 *     complete: boolean | null,        // see "Completeness" below
 *     degraded: boolean,
 *     degraded_reason: string | null,
 *   }
 *
 * Unrecognized events. `unrecognized_events` maps an event type to how many events of that type the
 * parser had no rule for, so a format change shows up in the record instead of reading as an idle
 * run. An event the parser reads, and one it knowingly skips (Claude Code `system/init`, OpenCode
 * `step_start`, Kiro status and bookkeeping updates and thought chunks), is not counted. The key is
 * the event's `type`; Claude Code appends `/<subtype>` for a `system` event other than `init`
 * (`system/api_retry`), and Kiro (ACP) uses `sessionUpdate/<name>` for an update kind it does not
 * know. An event with no string type is counted under `[no type]`. Keys are redacted and capped at
 * MAX_EVENT_TYPE characters; past MAX_UNRECOGNIZED_KEYS distinct keys the rest are counted under
 * `[other]`. The field is empty for a trace the parser fully understands. It is not an error: a
 * non-empty tally on a real capture means the CLI emits something new, or this parser misses it.
 *
 * Tool call ids. `tool_calls[].tool_call_id` is the id the runtime's own trace gives the call,
 * kept as the raw string (a numeric id is stringified, so id 0 becomes "0"). It is `null` when
 * the trace has none. It is redacted and capped like every other stored string, and is not
 * hashed or renamed. The id is not guaranteed unique: a repeated id still adds `duplicate_tool_id`,
 * and the repeated event is kept as its own call. This holds for all three runtimes.
 *  - Claude Code: the `tool_use` block's `id`, the same value a result carries as `tool_use_id`.
 *  - OpenCode: the tool part's `callID`, or the part's `id` when the trace has no usable `callID`.
 *  - Kiro (ACP): the `tool_call` update's `toolCallId`; a `tool_call_update` carries the same value.
 *  - Kiro (flat shape): the `tool_call` event's `tool_call_id`, or its `id` when that is absent.
 *
 * Skill loads. Only a load that provably happened is recorded.
 *  - Claude Code: a tool named exactly `Skill` whose paired tool_result is not an error. A call
 *    with no result yet is not a load, and neither is a differently named tool such as
 *    `mcp__x__Skill`. Other skill-loading tools (an MCP skills tool, for example) are not
 *    counted; they stay visible in `tool_calls`. The `skill_name` comes from the call's input,
 *    so it is redacted and capped at MAX_STORED_STRING characters like every other stored string.
 *  - Kiro: a completed call to a read tool (KIRO_READ_TOOL_NAMES, matched on the exact reported
 *    name, so `mcp__x__fs_read` does not count) whose path argument matches
 *    `skills/<name>/SKILL.md` (SKILL_PATH_PATTERN). Writes and failed reads are not loads. The path
 *    is read from `path`, `file_path` or `filePath` in the call's input (kiro-cli 3.0.0 sends
 *    `rawInput.path`), and from the same keys of each entry in an `operations` array. The
 *    `operations` form is not in any capture here; it is read because the review reported it, and is
 *    unverified. One call that reads several skill files records one load per file.
 *  - OpenCode reports no skill-load signal, so `skill_loads` stays empty.
 *
 * Kiro (ACP) tool names. The call's name is `_meta.kiro.toolName` when the event has one (reported
 * by the review, absent from the kiro-cli 3.0.0 captures here), else the ACP `kind` (`read` for the
 * built-in read tool in 3.0.0), else the `title` (`Read File`). `kind` is a coarse category, so
 * two different tools of one kind are indistinguishable by name.
 *
 * Completeness. `complete` says whether the trace reached its end:
 *  - Claude Code: true only when a top-level (non-subagent) `result` event was seen.
 *  - OpenCode: true when at least one `step_finish` event was seen.
 *  - Kiro (ACP): true when a `runFinished` event was seen, false when ACP events were seen but no
 *    `runFinished` came. Null when the trace holds no ACP event, including the flat shape, which
 *    has no terminal event to check.
 * A false value means the trace may be truncated, so its answer, usage and cost may be partial.
 *
 * Data handling. Everything the trace supplies as text passes through a redactor before it is
 * stored, and every stored string except `response_text` is capped. The built-in `defaultRedact`
 * masks AWS access key ids, secret-key and session-token values, and Bearer tokens.
 * `options.redact` (a function from string to string) replaces it; call `defaultRedact` inside
 * it to keep the built-in rules. A redactor that throws or returns a non-string yields
 * `[REDACTION_FAILED]` in place of the text. Other credential formats are not detected unless a
 * custom redactor adds a rule for them.
 *  - A parsed arguments or result value has no `name=value` text for those rules to match, so
 *    every string stored under a property named like a secret-key or session-token field
 *    (`SecretAccessKey`, `aws_session_token`, in any letter case), at any depth below it, is
 *    replaced with `[REDACTED]` without calling the redactor. This is the library's own rule, not
 *    part of `defaultRedact`, so it also applies when `options.redact` is supplied. Numbers,
 *    booleans and null are kept.
 *  - Redacted and capped at MAX_STORED_STRING characters: `tool_call_id`, `tool_name`,
 *    `raw_tool_name`, `skill_loads[].skill_name` and `raw_path`, `model_id`, each of `session_ids`, each of
 *    `available_tools`, and `errors[].message`.
 *  - `errors[].raw.event_type` is redacted and capped at MAX_EVENT_TYPE characters. A type that
 *    is not a string is stored as null.
 *  - `available_tools` keeps string entries only, at most MAX_AVAILABLE_TOOLS of them. A longer
 *    list adds an `available_tools_truncated` error.
 *  - Each stored arguments or result value keeps at most MAX_STORED_STRING characters in total
 *    across its string values and its object keys, and sets `truncated: true` on its call when
 *    it is cut. Keys are redacted like values. Past MAX_STORED_NODES values or MAX_STORED_DEPTH
 *    levels the rest is dropped and the call is marked truncated.
 *  - `response_text` is redacted but never truncated, because consumers of the record may need
 *    the whole answer. Redaction runs once on the whole answer, so a secret split across text
 *    blocks is masked.
 *
 * Known redaction limits. `defaultRedact` works on the text of a single value, so it does not
 * catch the shapes below. These are limits of the design, not defects. A caller who needs them
 * covered supplies `options.redact`.
 *  - A secret carried in a separate field from its name, for example an object with a `name`
 *    field that holds a credential variable name and a `value` field that holds the secret.
 *  - A security token in the query string of a signed URL.
 *  - An access key id directly adjacent to other capital letters or digits.
 *  - A property name outside the exact set it matches (the secret-key and session-token names
 *    above), such as a generic `password` or `authorization` field.
 *
 * Statuses.
 *  - A tool call is 'completed', 'error' or 'unknown' (no outcome seen). The first terminal
 *    status wins, in Claude Code and Kiro alike: once a call is 'completed' or 'error', a later
 *    result or update changes neither its status nor its result, and adds no `tool_error`. A
 *    later outcome that disagrees with the settled one adds a `conflicting_tool_result` error; a
 *    repeat of the same outcome adds nothing. OpenCode reports one fused event per call, so
 *    there is nothing to settle.
 *  - Kiro sets a status only from an explicit `completed`, from `failed` or `error`, or from an
 *    `error` field, which marks the call 'error' whatever status the update reports (including
 *    `completed` and a non-terminal one such as `in_progress`). An update with none of these,
 *    such as progress or content alone (`in_progress` in kiro-cli 3.0.0), leaves the status as it
 *    was. `failed` has not been seen in a capture; it follows the ACP status names.
 *
 * Numbers. Usage and cost are stored only as finite numbers >= 0. A value that is not, or an
 * OpenCode total that overflows to infinity when summed, becomes null and adds an
 * `invalid_number` error.
 *
 * Other record notes:
 *  - OpenCode `model_id` is null: its event stream does not name the model.
 *  - Kiro `model_id` is null for kiro-cli 3.0.0: its run events do not name the model that answered
 *    (the model setting it reports is `auto`, which is not a model id, so it is not read). Only the
 *    flat shape's dedicated `model` event sets it; a second, different value is kept out of the
 *    record and adds a `model_conflict` error.
 *  - Kiro (ACP) `response_text` is the `runFinished` event's `finalText` when it is present, else the
 *    `agent_message_chunk` texts joined in order. When `finalTextTruncated` is true and chunks
 *    exist, the chunks are kept. A `runFinished` status other than `success` adds a `result_error`.
 *  - Claude Code takes `model_id` from top-level events only, not from subagent events. A
 *    `result` event tagged with `parent_tool_use_id` is a subagent's: it does not set
 *    `complete`, `response_text`, `model_id`, `usage` or `cost_usd`. Assistant text blocks from
 *    events tagged with `parent_tool_use_id` are not added to `response_text` either.
 *  - Kiro `usage` and `cost_usd` are always null: its stream carries neither.
 *  - `options.expectedCallCount` is a non-negative integer used for the degraded check. Any
 *    other value is ignored and adds an `invalid_option` error.
 *
 * OpenTelemetry GenAI mapping. The table lists the nearest OpenTelemetry GenAI semantic-convention
 * attribute for each record field. Those conventions are marked Development and are still being
 * renamed, so the normalizer keeps its own field names on purpose and exports nothing to OTel.
 * The attribute names come from the registry at
 * https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md
 *
 *   Normalizer field                     Nearest OTel attribute
 *   model_id                             gen_ai.response.model
 *   session_ids[]                        gen_ai.conversation.id
 *   tool_calls[].tool_call_id            gen_ai.tool.call.id
 *   tool_calls[].raw_tool_name           gen_ai.tool.name
 *   tool_calls[].arguments               gen_ai.tool.call.arguments
 *   tool_calls[].result                  gen_ai.tool.call.result
 *   skill_loads[].skill_name             gen_ai.skill.name
 *   usage.input_tokens                   gen_ai.usage.input_tokens (see note)
 *   usage.output_tokens                  gen_ai.usage.output_tokens
 *   usage.cache_read_tokens              gen_ai.usage.cache_read.input_tokens
 *   usage.cache_write_tokens             gen_ai.usage.cache_write.input_tokens
 *   runtime, tool_calls[].tool_name,
 *   cost_usd, degraded                   none
 *
 * Note: OTel counts cached tokens inside its input-token total. The normalizer keeps
 * `usage.input_tokens` separate from the two cache counts, so an exporter has to add them.
 */

const SCHEMA_VERSION = 1;

/** Most string characters kept in one stored arguments or result value. */
const MAX_STORED_STRING = 8 * 1024;
/** Most values (nodes) kept in one stored arguments or result value; the rest is dropped. */
const MAX_STORED_NODES = 2000;
/** Deepest nesting level kept in one stored arguments or result value; the root is level 0. */
const MAX_STORED_DEPTH = 16;
/** Most characters kept in `errors[].raw.event_type`. */
const MAX_EVENT_TYPE = 64;
/** Most entries kept in `available_tools`. */
const MAX_AVAILABLE_TOOLS = 512;
const REDACTION_FAILED = '[REDACTION_FAILED]';

/** Most distinct keys kept in `unrecognized_events`; further types are counted under OTHER_EVENTS_KEY. */
const MAX_UNRECOGNIZED_KEYS = 64;
const OTHER_EVENTS_KEY = '[other]';
const NO_TYPE_KEY = '[no type]';

/**
 * Kiro tool names that read a file, matched exactly against the tool name as reported. `read` is
 * what kiro-cli 3.0.0 reports (as the ACP `kind`) for its built-in read tool. `fsRead` and
 * `fs_read` come from the flat synthetic shape and are not seen in any capture. A prefixed or
 * namespaced name such as `mcp__x__fs_read` or `plugin:s:fsRead` is a different tool and does
 * not match.
 */
const KIRO_READ_TOOL_NAMES = new Set(['read', 'fsRead', 'fs_read']);

/**
 * Kiro (ACP) `sessionUpdate` kinds the parser knowingly skips: thought and user echoes, plans,
 * and status or bookkeeping updates. They carry nothing the record needs, so they are not counted
 * as unrecognized. `session_info_update`, `available_commands_update` and `config_option_update`
 * are in the kiro-cli 3.0.0 captures; the rest are ACP-defined kinds not seen in them.
 */
const KIRO_ACP_SKIPPED_UPDATES = new Set([
  'session_info_update',
  'available_commands_update',
  'config_option_update',
  'current_mode_update',
  'agent_thought_chunk',
  'user_message_chunk',
  'plan',
]);

/**
 * Kiro has no skill-load event, so a load is a read of `.../skills/<name>/SKILL.md`. The match is
 * case-sensitive and anchored to a path segment: `myskills/x/SKILL.md` is not a skill path.
 */
const SKILL_PATH_PATTERN = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;

const AWS_KEY_ID_PATTERN = /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g;
const AWS_SECRET_FIELD_PATTERN =
  /((?:aws_)?(?:secret_?access_?key|session_?token)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s"'\\,}]+/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[\w.~+/=-]{16,}/gi;

/**
 * Property names that hold a secret: the field names AWS_SECRET_FIELD_PATTERN looks for in text,
 * matched at the end of an object key. Keep the two in step.
 */
const SECRET_PROPERTY_PATTERN = /(?:secret_?access_?key|session_?token)$/i;
/** Stored in place of a string found under a property that matches SECRET_PROPERTY_PATTERN. */
const SECRET_VALUE_MASK = '[REDACTED]';

/**
 * Built-in redactor: masks AWS access key ids (AKIA/ASIA), `aws_secret_access_key` and
 * `aws_session_token` values (also the `SecretAccessKey` / `SessionToken` JSON spellings), and
 * `Bearer <token>` where the token is at least 16 characters, so prose such as "Bearer
 * authentication" is left alone. It is a safety net for traces that leak credentials, not a
 * complete scrubber.
 */
function defaultRedact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(AWS_KEY_ID_PATTERN, '[REDACTED_AWS_KEY_ID]')
    .replace(AWS_SECRET_FIELD_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, '$1[REDACTED]');
}

/**
 * Collapses a raw tool name to its base identifier: `mcp__<server>__<tool>` and
 * `plugin:server:tool__subtool` both reduce to the lowercased tool part. Returns '' for a
 * missing or non-string name.
 */
function normalizeToolName(name) {
  if (typeof name !== 'string' || !name) return '';
  if (name.includes(':')) {
    const lastColon = name.lastIndexOf(':');
    const toolPart = name.slice(lastColon + 1);
    const lastSep = toolPart.lastIndexOf('__');
    return lastSep > 0 ? toolPart.slice(lastSep + 2).toLowerCase() : toolPart.toLowerCase();
  }
  const lastSep = name.lastIndexOf('__');
  if (lastSep > 0 && name.startsWith('mcp__')) {
    return name.slice(lastSep + 2).toLowerCase();
  }
  return name.toLowerCase();
}

/**
 * Returns `{ skill_name, source: 'path-heuristic', raw_path }` when `path` is a string ending in
 * `skills/<name>/SKILL.md`, else null. Backslashes count as separators; the name is never `.` or
 * `..`. `raw_path` is the separator-normalized path.
 */
function skillLoadFromPath(path) {
  if (typeof path !== 'string') return null;
  const normalized = path.replace(/\\/g, '/');
  const match = normalized.match(SKILL_PATH_PATTERN);
  if (!match || match[1] === '.' || match[1] === '..') return null;
  return { skill_name: match[1], source: 'path-heuristic', raw_path: normalized };
}

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Degraded rule: `tool_calls` is flagged, not fabricated, when it has fewer than half the
 * calls the ground truth expects, or is empty when at least one call was expected.
 * `expectedCallCount` must be a non-negative integer; anything else (including undefined and
 * null) means no expectation was given and the result is `{ degraded: false, reason: null }`.
 */
function assessDegraded(toolCalls, expectedCallCount) {
  if (!isNonNegativeInteger(expectedCallCount)) {
    return { degraded: false, reason: null };
  }
  const actual = Array.isArray(toolCalls) ? toolCalls.length : 0;
  if (expectedCallCount >= 1 && actual === 0) {
    return {
      degraded: true,
      reason: `expected at least 1 tool call (ground truth expects ${expectedCallCount}), got 0`,
    };
  }
  if (actual < expectedCallCount / 2) {
    return {
      degraded: true,
      reason: `tool_calls has ${actual} call(s), fewer than half the expected ${expectedCallCount}`,
    };
  }
  return { degraded: false, reason: null };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A key for matching a call id to its result: strings and numbers only, so id 0 works. */
function idKey(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/** First argument that is a non-empty string; an object contributes its `message` string. */
function firstMessage(fallback, ...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (isObject(candidate) && typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  return fallback;
}

/** A usable tool name as a string, or null: non-empty strings, numbers and booleans qualify. */
function toolNameFrom(value) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Reads a numeric trace value: absent, valid (finite and >= 0, numeric strings coerced) or invalid. */
function parseNonNegative(value) {
  if (value === undefined || value === null) return { state: 'absent', value: null };
  let n = value;
  if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return { state: 'ok', value: n };
  return { state: 'invalid', value: null };
}

function baseRecord(runtime) {
  return {
    schema_version: SCHEMA_VERSION,
    runtime,
    model_id: null,
    session_ids: [],
    tool_calls: [],
    skill_loads: [],
    available_tools: 'unknown',
    response_text: '',
    usage: null,
    cost_usd: null,
    errors: [],
    parse_errors: 0,
    unrecognized_events: {},
    complete: null,
    degraded: false,
    degraded_reason: null,
  };
}

/**
 * Per-trace working state: the record under construction, the active redactor and the helpers
 * that apply redaction and size caps before anything is stored.
 */
function createContext(runtime, options) {
  const opts = isObject(options) ? options : {};
  const record = baseRecord(runtime);

  let redactFn = defaultRedact;
  let invalidRedact = false;
  if (opts.redact !== undefined && opts.redact !== null) {
    if (typeof opts.redact === 'function') redactFn = opts.redact;
    else invalidRedact = true;
  }
  // A redactor that throws or returns a non-string must not let the original text through.
  const redact = (text) => {
    try {
      const out = redactFn(text);
      return typeof out === 'string' ? out : REDACTION_FAILED;
    } catch {
      return REDACTION_FAILED;
    }
  };

  const cap = (text, max = MAX_STORED_STRING) => (text.length > max ? text.slice(0, max) : text);
  // Redact first, then cap, so a credential cut by the cap cannot slip past the redactor.
  const text = (value, max = MAX_STORED_STRING) => cap(redact(String(value)), max);

  // Event type -> count, kept in a Map so a hostile type name such as "__proto__" is only a key.
  const unrecognized = new Map();

  const ctx = {
    opts,
    record,
    redact,
    text,
    /**
     * Counts one event the parser has no rule for, under `key` (redacted and capped). Past
     * MAX_UNRECOGNIZED_KEYS distinct keys, new ones are counted under OTHER_EVENTS_KEY.
     */
    noteUnrecognized(key) {
      let name = typeof key === 'string' && key ? text(key, MAX_EVENT_TYPE) : NO_TYPE_KEY;
      if (!unrecognized.has(name) && unrecognized.size >= MAX_UNRECOGNIZED_KEYS) name = OTHER_EVENTS_KEY;
      unrecognized.set(name, (unrecognized.get(name) ?? 0) + 1);
    },
    /** Writes the tally into the record as a plain object. Called once, from finalize. */
    flushUnrecognized() {
      const out = {};
      for (const [name, count] of unrecognized) {
        Object.defineProperty(out, name, { value: count, enumerable: true, writable: true, configurable: true });
      }
      record.unrecognized_events = out;
    },
    /**
     * Records a session id once. A second distinct id adds a `multiple_sessions` error. A missing
     * or non-string id changes nothing.
     */
    noteSessionId(rawSessionId, line, eventType) {
      if (typeof rawSessionId !== 'string' || !rawSessionId) return;
      const sessionId = text(rawSessionId);
      if (record.session_ids.includes(sessionId)) return;
      record.session_ids.push(sessionId);
      if (record.session_ids.length === 2) {
        ctx.addError('multiple_sessions', 'trace contains more than one session id', line, eventType);
      }
    },
    /** Redacts the final answer. It is never capped, because consumers may need all of it. */
    redactResponse: (raw) => (raw === '' ? '' : redact(raw)),
    addError(type, message, line = null, eventType = null) {
      record.errors.push({
        type,
        message: text(message),
        line,
        raw: { event_type: typeof eventType === 'string' ? text(eventType, MAX_EVENT_TYPE) : null, line },
      });
    },
    /**
     * Redacts every string in `value` and caps total string content. A string under a property
     * named like a secret field is replaced with SECRET_VALUE_MASK instead. Returns
     * `{ value, truncated }`.
     */
    sanitize(value) {
      if (value === undefined || value === null) return { value: null, truncated: false };
      const state = { budget: MAX_STORED_STRING, nodes: 0, truncated: false };
      // `secret` is true below a property named like a secret field, at any depth.
      const walk = (node, depth, secret) => {
        state.nodes += 1;
        if (state.nodes > MAX_STORED_NODES || depth > MAX_STORED_DEPTH) {
          state.truncated = true;
          return null;
        }
        if (typeof node === 'string') {
          const masked = secret ? SECRET_VALUE_MASK : redact(node);
          if (masked.length > state.budget) {
            const kept = masked.slice(0, state.budget);
            state.budget = 0;
            state.truncated = true;
            return kept;
          }
          state.budget -= masked.length;
          return masked;
        }
        if (Array.isArray(node)) {
          const out = [];
          for (const item of node) {
            if (state.nodes > MAX_STORED_NODES) {
              state.truncated = true;
              break;
            }
            out.push(walk(item, depth + 1, secret));
          }
          return out;
        }
        if (isObject(node)) {
          const out = {};
          for (const [rawKey, item] of Object.entries(node)) {
            if (state.nodes > MAX_STORED_NODES) {
              state.truncated = true;
              break;
            }
            // Keys are stored text too: they are redacted and count toward the same budget.
            let key = redact(rawKey);
            if (key.length > state.budget) {
              state.truncated = true;
              if (state.budget === 0) break;
              key = key.slice(0, state.budget);
              state.budget = 0;
            } else {
              state.budget -= key.length;
            }
            Object.defineProperty(out, key, {
              value: walk(item, depth + 1, secret || SECRET_PROPERTY_PATTERN.test(rawKey)),
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
          return out;
        }
        return node;
      };
      const out = walk(value, 0, false);
      return { value: out, truncated: state.truncated };
    },
    /**
     * Builds a tool call entry. `args` is sanitized here. A name that is not a non-empty string,
     * number or boolean is recorded as 'unknown' and adds an `invalid_tool_name` error.
     */
    newCall(rawName, args, { line = null, eventType = null, subagent = false, toolCallId = null } = {}) {
      const reported = toolNameFrom(rawName);
      if (reported === null) {
        ctx.addError('invalid_tool_name', 'tool name is missing or not a string; recorded as unknown', line, eventType);
      }
      const name = reported ?? 'unknown';
      const safeArgs = ctx.sanitize(isObject(args) ? args : {});
      // The id the runtime reported, as a string: redacted and capped like other stored text.
      // A missing, empty or non-string/number id is null.
      const idText = idKey(toolCallId);
      return {
        tool_call_id: idText === null || idText === '' ? null : text(idText),
        tool_name: text(normalizeToolName(name)),
        raw_tool_name: text(name),
        arguments: safeArgs.value,
        status: 'unknown',
        result: null,
        truncated: safeArgs.truncated,
        subagent,
      };
    },
    setResult(call, rawResult) {
      const safe = ctx.sanitize(rawResult);
      call.result = safe.value;
      call.truncated = call.truncated || safe.truncated;
    },
    /**
     * Applies a terminal outcome to a call: the first terminal status wins. Returns true when
     * `status` was applied (the call was still 'unknown'), false when the call was already
     * terminal. A later outcome that disagrees with the settled status adds a
     * `conflicting_tool_result` error; one that agrees changes nothing.
     */
    settleStatus(call, status, label, line, eventType) {
      if (call.status === 'unknown') {
        call.status = status;
        return true;
      }
      if (call.status !== status) {
        ctx.addError(
          'conflicting_tool_result',
          `${label} reported ${status} after it was already ${call.status}; the first status was kept`,
          line,
          eventType,
        );
      }
      return false;
    },
    /** Parses one numeric field; an invalid value adds an `invalid_number` error. */
    readNumber(value, field, line, eventType) {
      const parsed = parseNonNegative(value);
      if (parsed.state === 'invalid') {
        ctx.addError('invalid_number', `${field} is not a finite number >= 0`, line, eventType);
      }
      return parsed;
    },
  };

  if (invalidRedact) {
    ctx.addError('invalid_option', 'options.redact must be a function; the built-in redactor was used');
  }
  return ctx;
}

/**
 * Builds `available_tools` from a list in the trace: string entries only, each redacted and
 * capped, at most MAX_AVAILABLE_TOOLS of them. A longer list adds an `available_tools_truncated`
 * error carrying the original count.
 */
function readAvailableTools(ctx, tools, line, eventType) {
  const kept = [];
  let total = 0;
  for (const tool of tools) {
    if (typeof tool !== 'string') continue;
    total += 1;
    if (kept.length < MAX_AVAILABLE_TOOLS) kept.push(ctx.text(tool));
  }
  if (total > MAX_AVAILABLE_TOOLS) {
    ctx.addError(
      'available_tools_truncated',
      `available_tools listed ${total} entries; the first ${MAX_AVAILABLE_TOOLS} were kept`,
      line,
      eventType,
    );
  }
  return kept;
}

/**
 * Registers a call id so a later result can find the call. A duplicate id keeps the first
 * mapping and adds a `duplicate_tool_id` error.
 */
function registerCallId(ctx, pending, rawId, index, line, eventType) {
  const key = idKey(rawId);
  if (key === null) return;
  if (pending.has(key)) {
    ctx.addError('duplicate_tool_id', `tool call id ${key} appeared more than once`, line, eventType);
    return;
  }
  pending.set(key, index);
}

/**
 * Walks the events of a raw trace. `handler(event, lineNumber, state)` sets `state.bad = true`
 * for an unusable shape. A handler that throws is treated the same way.
 */
function readEvents(rawTrace, ctx, handler) {
  let lines;
  if (Array.isArray(rawTrace)) {
    // A string element may hold several newline-delimited events (a collected stdout chunk), so
    // split it. A parsed event, or anything else, passes through as one item.
    lines = rawTrace.flatMap((item) => (typeof item === 'string' ? item.split('\n') : [item]));
  } else if (rawTrace === undefined || rawTrace === null) {
    lines = [];
  } else {
    lines = String(rawTrace).split('\n');
  }

  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const lineNo = i + 1;
    let event;
    if (typeof item === 'string') {
      if (item.trim() === '') continue;
      try {
        event = JSON.parse(item);
      } catch {
        ctx.record.parse_errors += 1;
        continue;
      }
    } else {
      event = item;
    }
    if (!isObject(event)) {
      ctx.record.parse_errors += 1;
      continue;
    }
    const state = { bad: false };
    try {
      handler(event, lineNo, state);
    } catch {
      state.bad = true;
    }
    if (state.bad) {
      // A pre-parsed event can carry a getter that throws, so reading its type must not throw.
      let eventType = null;
      try {
        if (typeof event.type === 'string') eventType = event.type;
      } catch {
        eventType = null;
      }
      ctx.addError('malformed_event', 'event has an unusable shape and was skipped', lineNo, eventType);
    }
  }
}

function finalize(ctx) {
  const { record, opts } = ctx;
  let expected = opts.expectedCallCount;
  if (expected !== undefined && expected !== null && !isNonNegativeInteger(expected)) {
    ctx.addError('invalid_option', 'expectedCallCount must be a non-negative integer; it was ignored');
    expected = undefined;
  }
  const { degraded, reason } = assessDegraded(record.tool_calls, expected);
  record.degraded = degraded;
  record.degraded_reason = reason;
  ctx.flushUnrecognized();
  return record;
}

/**
 * Parses a Claude Code `--output-format stream-json` trace. A tool_use sits in an `assistant`
 * event's content; its result arrives in a later `user` event as a `tool_result` block carrying
 * the matching `tool_use_id`. Results are paired to calls first, and skill loads are decided
 * after the whole trace is read. A top-level `result` event carries the final answer, usage and
 * cost. Events with `parent_tool_use_id` come from a subagent: they are kept, and their tool
 * calls carry `subagent: true`, but a subagent `result` event sets none of the top-level fields.
 */
function normalizeClaudeCode(rawTrace, options = {}) {
  const ctx = createContext('claude-code', options);
  const { record } = ctx;
  record.complete = false;

  const pending = new Map(); // tool_use id -> index into record.tool_calls
  const skillCandidates = new Map(); // call index -> skill name from a tool named exactly "Skill"
  let responseText = ''; // raw until the end, so a secret split across text blocks is still redacted

  readEvents(rawTrace, ctx, (event, lineNo, state) => {
    const subagent = Boolean(event.parent_tool_use_id);

    if (event.type === 'system' && event.subtype === 'init') {
      record.available_tools = Array.isArray(event.tools)
        ? readAvailableTools(ctx, event.tools, lineNo, 'system')
        : 'unknown';
      return;
    }

    if (event.type === 'assistant') {
      const message = event.message;
      if (message === undefined || message === null) return;
      if (!isObject(message)) {
        state.bad = true;
        return;
      }
      if (!subagent && typeof message.model === 'string' && message.model) {
        record.model_id = ctx.text(message.model);
      }
      const content = message.content;
      if (content === undefined || content === null) return;
      if (!Array.isArray(content)) {
        state.bad = true;
        return;
      }
      for (const block of content) {
        if (!isObject(block)) {
          state.bad = true;
          continue;
        }
        if (block.type === 'tool_use') {
          const call = ctx.newCall(block.name, block.input, {
            line: lineNo,
            eventType: 'assistant',
            subagent,
            toolCallId: block.id,
          });
          record.tool_calls.push(call);
          const index = record.tool_calls.length - 1;
          registerCallId(ctx, pending, block.id, index, lineNo, 'assistant');
          if (block.name === 'Skill' && isObject(block.input)) {
            const skillName = [block.input.skill, block.input.name].find((v) => typeof v === 'string' && v);
            if (skillName) skillCandidates.set(index, skillName);
          }
        } else if (block.type === 'text') {
          // Subagent text is the subagent's own working, not the session's answer.
          if (typeof block.text !== 'string') state.bad = true;
          else if (!subagent) responseText += block.text;
        }
      }
      return;
    }

    if (event.type === 'user') {
      const content = isObject(event.message) ? event.message.content : undefined;
      if (!Array.isArray(content)) return; // a plain-text user turn carries no results
      for (const block of content) {
        if (!isObject(block)) {
          state.bad = true;
          continue;
        }
        if (block.type !== 'tool_result') continue;
        const key = idKey(block.tool_use_id);
        const index = key === null ? undefined : pending.get(key);
        if (index === undefined) continue;
        const call = record.tool_calls[index];
        const failed = Boolean(block.is_error);
        const label = `tool_use_id ${key}`;
        if (!ctx.settleStatus(call, failed ? 'error' : 'completed', label, lineNo, 'user')) continue;
        ctx.setResult(call, block.content);
        if (failed) {
          ctx.addError('tool_error', `${label} returned an error`, lineNo, 'user');
        }
      }
      return;
    }

    if (event.type === 'result') {
      // Only the top-level result closes the session. A result tagged with parent_tool_use_id
      // belongs to a subagent and must not set completeness, the answer, the model, usage or cost.
      if (!subagent) {
        record.complete = true;
        if (typeof event.result === 'string' && event.result) {
          responseText = event.result;
        }
        if (typeof event.model === 'string' && event.model) {
          record.model_id = ctx.text(event.model);
        }
        if (isObject(event.usage)) {
          const read = (value, field) => ctx.readNumber(value, `usage.${field}`, lineNo, 'result').value;
          record.usage = {
            input_tokens: read(event.usage.input_tokens, 'input_tokens'),
            output_tokens: read(event.usage.output_tokens, 'output_tokens'),
            cache_read_tokens: read(event.usage.cache_read_input_tokens, 'cache_read_input_tokens'),
            cache_write_tokens: read(event.usage.cache_creation_input_tokens, 'cache_creation_input_tokens'),
          };
        } else if (event.usage !== undefined && event.usage !== null) {
          ctx.addError('invalid_number', 'usage is not an object', lineNo, 'result');
        }
        const cost = ctx.readNumber(event.total_cost_usd, 'total_cost_usd', lineNo, 'result');
        if (cost.state === 'ok') record.cost_usd = cost.value;
      }
      if (event.is_error) {
        ctx.addError(
          'result_error',
          firstMessage('claude code reported is_error on result event', event.result),
          lineNo,
          'result',
        );
      }
      return;
    }

    if (event.type === 'error') {
      ctx.addError(
        'runtime_error',
        firstMessage('claude code error event', event.message, event.error),
        lineNo,
        'error',
      );
      return;
    }

    // Reached by any event type above that returned no rule for it, and by a `system` event other
    // than `init` (`api_retry` appears in real traces).
    ctx.noteUnrecognized(
      event.type === 'system' && typeof event.subtype === 'string' && event.subtype
        ? `system/${event.subtype}`
        : event.type,
    );
  });

  for (const [index, skillName] of skillCandidates) {
    const call = record.tool_calls[index];
    if (call.status !== 'completed') continue;
    record.skill_loads.push({
      skill_name: ctx.text(skillName),
      source: 'dedicated-event',
      raw_path: null,
      subagent: call.subagent,
    });
  }

  record.response_text = ctx.redactResponse(responseText);
  return finalize(ctx);
}

/**
 * Parses an OpenCode `run --format json` trace. Events read:
 *  - `tool_use`: the call and its result fused into one event; `part.state.status` is the outcome.
 *  - `step_finish`: per-turn usage and cost, summed across turns. A repeated part id counts once.
 *  - `text`: assistant output; the last non-empty one is the final answer.
 *  - `error`: a runtime error.
 * `step_start` carries nothing the record needs and is skipped silently; any other event type is
 * counted in `unrecognized_events`. This shape is unverified against a real run (see "Verification
 * status" in the module header). OpenCode emits no terminal result event, so `complete` means
 * "at least one step_finish was seen". A repeated call id adds `duplicate_tool_id`. `response_text`
 * keeps the answer as reported (redacted), including any markdown fence; stripping it is
 * left to the consumer.
 * `available_tools` stays 'unknown' because OpenCode lists no tools at session start. More than
 * one session id in a trace adds a `multiple_sessions` error.
 */
function normalizeOpenCode(rawTrace, options = {}) {
  const ctx = createContext('opencode', options);
  const { record } = ctx;
  record.complete = false;

  let lastText = '';
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  const invalidTotals = new Set();
  const cost = { sum: 0, seen: false, invalid: false };
  const seenStepFinish = new Set();
  let sawStepFinish = false;

  const pending = new Map(); // call id -> index into record.tool_calls, to detect a repeated id

  readEvents(rawTrace, ctx, (event, lineNo, state) => {
    ctx.noteSessionId(
      typeof event.sessionID === 'string' && event.sessionID
        ? event.sessionID
        : isObject(event.part) && typeof event.part.sessionID === 'string'
          ? event.part.sessionID
          : null,
      lineNo,
      event.type,
    );

    if (event.type === 'tool_use') {
      if (!isObject(event.part)) {
        state.bad = true;
        return;
      }
      const toolState = isObject(event.part.state) ? event.part.state : {};
      // `callID` is OpenCode's call id; `part.id` is the fallback for traces that carry only that.
      const toolCallId = idKey(event.part.callID) ? event.part.callID : event.part.id;
      const call = ctx.newCall(event.part.tool, toolState.input, {
        line: lineNo,
        eventType: 'tool_use',
        toolCallId,
      });
      // OpenCode fuses call and result into one event, so `state.status` is the outcome. Any
      // status other than "completed" is an error so an in-flight call never reads as completed.
      call.status = toolState.status === 'completed' ? 'completed' : 'error';
      ctx.setResult(call, toolState.output);
      record.tool_calls.push(call);
      // A repeated id keeps the event as its own call and adds `duplicate_tool_id`, as in the
      // other runtimes. No result ever looks the call up by id, so the index is not used again.
      registerCallId(ctx, pending, toolCallId, record.tool_calls.length - 1, lineNo, 'tool_use');
      if (call.status !== 'completed') {
        ctx.addError('tool_error', `opencode tool "${call.raw_tool_name}" did not complete`, lineNo, 'tool_use');
      }
      return;
    }

    if (event.type === 'step_finish') {
      if (!isObject(event.part)) {
        state.bad = true;
        return;
      }
      sawStepFinish = true;
      record.complete = true;
      const partKey = idKey(event.part.id);
      if (partKey !== null) {
        if (seenStepFinish.has(partKey)) return;
        seenStepFinish.add(partKey);
      }
      const stepCost = ctx.readNumber(event.part.cost, 'cost', lineNo, 'step_finish');
      if (stepCost.state === 'ok') {
        cost.sum += stepCost.value;
        cost.seen = true;
      } else if (stepCost.state === 'invalid') {
        cost.invalid = true;
      }
      const tokens = isObject(event.part.tokens) ? event.part.tokens : {};
      const cache = isObject(tokens.cache) ? tokens.cache : {};
      const fields = [
        ['input_tokens', tokens.input, 'tokens.input'],
        ['output_tokens', tokens.output, 'tokens.output'],
        ['cache_read_tokens', cache.read, 'tokens.cache.read'],
        ['cache_write_tokens', cache.write, 'tokens.cache.write'],
      ];
      for (const [field, raw, label] of fields) {
        const parsed = ctx.readNumber(raw, label, lineNo, 'step_finish');
        if (parsed.state === 'ok') totals[field] += parsed.value;
        else if (parsed.state === 'invalid') invalidTotals.add(field);
      }
      return;
    }

    if (event.type === 'text') {
      if (!isObject(event.part) || typeof event.part.text !== 'string') {
        state.bad = true;
        return;
      }
      if (event.part.text.trim() !== '') lastText = event.part.text;
      return;
    }

    if (event.type === 'error') {
      ctx.addError('runtime_error', firstMessage('opencode error event', event.error, event.message), lineNo, 'error');
      return;
    }

    // `step_start` is the one event type known to carry nothing the record needs.
    if (event.type !== 'step_start') ctx.noteUnrecognized(event.type);
  });

  record.response_text = ctx.redactResponse(lastText);
  // Valid values can still sum past the largest finite number.
  if (cost.seen && !cost.invalid && !Number.isFinite(cost.sum)) {
    ctx.addError('invalid_number', 'summed cost is not a finite number', null, 'step_finish');
    cost.invalid = true;
  }
  if (sawStepFinish) {
    record.usage = {};
    for (const field of Object.keys(totals)) {
      if (!invalidTotals.has(field) && !Number.isFinite(totals[field])) {
        ctx.addError('invalid_number', `summed ${field} is not a finite number`, null, 'step_finish');
        invalidTotals.add(field);
      }
      record.usage[field] = invalidTotals.has(field) ? null : totals[field];
    }
  }
  record.cost_usd = cost.seen && !cost.invalid ? cost.sum : null;

  return finalize(ctx);
}

/** Paths a Kiro read call names: the first of `path`, `file_path`, `filePath`, then each `operations[]` entry's. */
function kiroReadPaths(args) {
  const pick = (source) => [source.path, source.file_path, source.filePath].find((v) => typeof v === 'string');
  const paths = [];
  const top = pick(args);
  if (top !== undefined) paths.push(top);
  if (Array.isArray(args.operations)) {
    for (const operation of args.operations) {
      const found = isObject(operation) ? pick(operation) : undefined;
      if (found !== undefined) paths.push(found);
    }
  }
  return paths;
}

/**
 * Parses a Kiro CLI `--output-format stream-json` trace. Two shapes are read; see "Verification
 * status" in the module header for which one is real.
 *
 * ACP envelope (kiro-cli 3.0.0, verified against captures). Each line is `{ type, data }`:
 *  - `runStarted`: skipped. It marks the trace as ACP, so `complete` becomes false until
 *    `runFinished` arrives.
 *  - `sessionUpdate`: `data.sessionId` goes to `session_ids`, and `data.update.sessionUpdate`
 *    names the kind:
 *      - `tool_call`: `toolCallId`, `rawInput` (the arguments) and the tool name (see "Kiro (ACP)
 *        tool names" in the module header).
 *      - `tool_call_update`: matched by `toolCallId`; `status` and `rawOutput` (the result).
 *      - `agent_message_chunk`: `content.text` is appended to the answer.
 *      - the kinds in KIRO_ACP_SKIPPED_UPDATES are skipped. Any other kind is counted in
 *        `unrecognized_events` as `sessionUpdate/<name>`.
 *  - `runFinished`: `complete` becomes true; `finalText` is the answer when present. A `status`
 *    other than `success` adds a `result_error`.
 * There is no init event, so `available_tools` stays 'unknown', and no token or cost data, so
 * `usage` and `cost_usd` stay null.
 *
 * Flat shape (no known release; kept for the synthetic fixtures): `agent_message_chunk` with a
 * string `content`, `tool_call`, `tool_call_update` and `model` events, plus thought chunks, which
 * are ignored. A `tool_call_update` is matched to its `tool_call` by `tool_call_id` (or `id`; id 0
 * is valid).
 *
 * Both shapes share the status rules. Status `failed` and `error` both map to 'error' and add an
 * error entry, and so does an `error` field on any update, even one that reports `completed`;
 * `completed` without an error maps to 'completed'; an update with neither a terminal status nor an
 * error leaves the status as it was. The first terminal status is kept (see "Statuses" in the
 * module comment). A duplicate call id is kept as its own unpaired call and adds a
 * `duplicate_tool_id` error; the first call keeps its pairing.
 *
 * Skill loads are decided after the whole trace is read: a call whose tool name, as reported,
 * is exactly one of KIRO_READ_TOOL_NAMES and whose input names a path that matches
 * SKILL_PATH_PATTERN counts once its status is 'completed' (see "Skill loads" in the module
 * header for the input keys).
 */
function normalizeKiro(rawTrace, options = {}) {
  const ctx = createContext('kiro', options);
  const { record } = ctx;

  const pending = new Map();
  const skillCandidates = new Map(); // call index -> skill loads, kept if the call completes
  let responseText = ''; // raw until the end, so a secret split across chunks is still redacted
  let finalText = null; // the `runFinished` answer, applied after the loop
  let finalTextTruncated = false;

  /** Records a tool call from either shape. */
  const addCall = (rawName, rawArgs, rawId, lineNo, eventType) => {
    const call = ctx.newCall(rawName, rawArgs, { line: lineNo, eventType, toolCallId: rawId });
    record.tool_calls.push(call);
    const index = record.tool_calls.length - 1;
    registerCallId(ctx, pending, rawId, index, lineNo, eventType);
    // The read-tool match uses the name as reported, not the normalized one, so a namespaced
    // tool that merely ends in "fs_read" is not mistaken for the built-in read tool.
    if (typeof rawName === 'string' && KIRO_READ_TOOL_NAMES.has(rawName)) {
      const loads = [];
      for (const path of kiroReadPaths(rawArgs)) {
        const load = skillLoadFromPath(path);
        if (load) {
          loads.push({
            skill_name: ctx.text(load.skill_name),
            source: load.source,
            raw_path: ctx.text(load.raw_path),
            subagent: false,
          });
        }
      }
      if (loads.length > 0) skillCandidates.set(index, loads);
    }
  };

  /** Applies a status/result update from either shape to the call it names. */
  const updateCall = (rawId, { status, error, result }, lineNo, eventType) => {
    const key = idKey(rawId);
    const index = key === null ? undefined : pending.get(key);
    if (index === undefined) return;
    const call = record.tool_calls[index];
    const reported = typeof status === 'string' && status ? status.toLowerCase() : null;
    // An `error` field is a failure whatever status the update reports, so the recorded error
    // and the call status always agree.
    const failed = reported === 'failed' || reported === 'error' || Boolean(error);
    // Only an explicit `completed` or a failure sets a status. An update with neither (progress,
    // or content only) leaves it alone. Once a call is terminal, a later update changes nothing.
    const terminal = failed ? 'error' : reported === 'completed' ? 'completed' : null;
    const open =
      terminal === null
        ? call.status === 'unknown'
        : ctx.settleStatus(call, terminal, `kiro tool call ${key}`, lineNo, eventType);
    if (!open) return;
    if (result !== undefined && result !== null) ctx.setResult(call, result);
    if (failed) {
      ctx.addError('tool_error', firstMessage(`kiro tool call ${key} reported an error`, error), lineNo, eventType);
    }
  };

  /** Marks the trace as ACP: complete stays false until `runFinished`. */
  const markAcp = () => {
    if (record.complete === null) record.complete = false;
  };

  readEvents(rawTrace, ctx, (event, lineNo, state) => {
    if (event.type === 'runStarted') {
      markAcp();
      return;
    }

    if (event.type === 'sessionUpdate') {
      markAcp();
      const data = event.data;
      const update = isObject(data) ? data.update : undefined;
      if (!isObject(update)) {
        state.bad = true;
        return;
      }
      ctx.noteSessionId(data.sessionId, lineNo, 'sessionUpdate');
      const kind = update.sessionUpdate;

      if (kind === 'tool_call') {
        const meta = isObject(update._meta) && isObject(update._meta.kiro) ? update._meta.kiro : {};
        const rawName = [meta.toolName, update.kind, update.title].find((v) => typeof v === 'string' && v);
        addCall(rawName, isObject(update.rawInput) ? update.rawInput : {}, update.toolCallId, lineNo, 'tool_call');
        return;
      }

      if (kind === 'tool_call_update') {
        updateCall(
          update.toolCallId,
          { status: update.status, error: update.error, result: update.rawOutput },
          lineNo,
          'tool_call_update',
        );
        return;
      }

      if (kind === 'agent_message_chunk') {
        const content = update.content;
        if (isObject(content) && content.type === 'text' && typeof content.text === 'string') {
          responseText += content.text;
        }
        return;
      }

      if (typeof kind === 'string' && KIRO_ACP_SKIPPED_UPDATES.has(kind)) return;
      ctx.noteUnrecognized(typeof kind === 'string' && kind ? `sessionUpdate/${kind}` : 'sessionUpdate');
      return;
    }

    if (event.type === 'runFinished') {
      markAcp();
      const data = event.data;
      if (!isObject(data)) {
        state.bad = true;
        return;
      }
      ctx.noteSessionId(data.sessionId, lineNo, 'runFinished');
      record.complete = true;
      if (typeof data.finalText === 'string' && data.finalText) {
        finalText = data.finalText;
        finalTextTruncated = data.finalTextTruncated === true;
      }
      if (typeof data.status === 'string' && data.status && data.status !== 'success') {
        ctx.addError('result_error', `kiro run finished with status ${data.status}`, lineNo, 'runFinished');
      }
      return;
    }

    if (event.type === 'agent_message_chunk') {
      if (typeof event.content === 'string') responseText += event.content;
      return;
    }

    if (event.type === 'agent_thought_chunk') return;

    if (event.type === 'tool_call') {
      const rawArgs = isObject(event.arguments) ? event.arguments : isObject(event.input) ? event.input : {};
      addCall(event.tool_name ?? event.name ?? event.tool, rawArgs, event.tool_call_id ?? event.id, lineNo, 'tool_call');
      return;
    }

    if (event.type === 'tool_call_update') {
      updateCall(
        event.tool_call_id ?? event.id,
        { status: event.status, error: event.error, result: event.result ?? event.output },
        lineNo,
        'tool_call_update',
      );
      return;
    }

    if (event.type === 'model') {
      if (typeof event.model !== 'string' || !event.model) return;
      const modelId = ctx.text(event.model);
      if (record.model_id === null) {
        record.model_id = modelId;
      } else if (record.model_id !== modelId) {
        ctx.addError('model_conflict', 'trace reports more than one model id; the first was kept', lineNo, 'model');
      }
      return;
    }

    if (event.type === 'error') {
      ctx.addError('runtime_error', firstMessage('kiro error event', event.message, event.error), lineNo, 'error');
      return;
    }

    ctx.noteUnrecognized(event.type);
  });

  for (const [index, loads] of skillCandidates) {
    if (record.tool_calls[index].status === 'completed') record.skill_loads.push(...loads);
  }

  // The runFinished answer is the final one. A truncated copy yields to the streamed chunks.
  if (finalText !== null && (!finalTextTruncated || responseText === '')) responseText = finalText;
  record.response_text = ctx.redactResponse(responseText);
  return finalize(ctx);
}

/**
 * Entry point. `runtime` is 'claude-code', 'opencode' or 'kiro'; `rawTrace` is a string of
 * newline-delimited JSON events, an array of such strings, or an array of parsed events.
 * Options: `expectedCallCount` (non-negative integer, for the degraded check) and `redact`
 * (function from string to string, replacing the built-in redactor).
 */
function normalizeTrace(runtime, rawTrace, options = {}) {
  switch (runtime) {
    case 'claude-code':
      return normalizeClaudeCode(rawTrace, options);
    case 'opencode':
      return normalizeOpenCode(rawTrace, options);
    case 'kiro':
      return normalizeKiro(rawTrace, options);
    default:
      throw new Error(`trace-normalizer: unknown runtime "${runtime}" (expected claude-code, opencode, or kiro)`);
  }
}

module.exports = {
  SCHEMA_VERSION,
  MAX_STORED_STRING,
  MAX_EVENT_TYPE,
  MAX_AVAILABLE_TOOLS,
  KIRO_READ_TOOL_NAMES,
  SKILL_PATH_PATTERN,
  normalizeTrace,
  normalizeClaudeCode,
  normalizeOpenCode,
  normalizeKiro,
  normalizeToolName,
  skillLoadFromPath,
  assessDegraded,
  defaultRedact,
};
