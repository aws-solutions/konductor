// SPDX-License-Identifier: Apache-2.0
import { isMap, isScalar, isSeq, type YAMLMap } from 'yaml';
import {
  codePointLength,
  FORMAT,
  isName,
  isUsableStageName,
  MAX_INTENT_CHARS,
  MAX_PROMPT_CHARS,
  MAX_STAGES,
  PATH_PATTERN,
  REFERENCE_PATTERN,
  RESERVED_STAGE_NAMES,
  SUGGESTED_VERSION,
  VERSION_PATTERN,
} from './contract.ts';
import { Reporter, type Segment } from './diagnostics.ts';
import {
  builtInKeys,
  CHECK_KEYS,
  GOAL_KEYS,
  INTENT_KEYS,
  INTENT_STRING_SLICE,
  isBuiltIn,
  isStageKind,
  PARAMS_KEYS,
  REFERENCE_SLICE,
  sliceOf,
  STAGE_KEYS,
  TOP_KEYS,
  type KeyTable,
  type Slice,
} from './keys.ts';
import type {
  Check,
  CheckResult,
  Intent,
  Param,
  Stage,
  WorkflowView,
} from './model.ts';
import { SourceMap } from './source-map.ts';
import { suggestKey } from './suggest.ts';
import {
  entriesOf,
  findUnsupported,
  documentSpanOf,
  parseDocuments,
  spanOf,
  valueSpanOf,
  type MapEntry,
} from './yaml-subset.ts';

const NAME_RULE =
  'must be lower-case letters, digits and hyphens, start with a letter or digit, and have at most 64 characters';

interface Context {
  reporter: Reporter;
  workflowName: string;
}

/**
 * Checks the text of a workflow and reports every problem it finds. The view
 * is `null` when there is an error.
 */
export function checkWorkflowText(
  text: string,
  workflowName: string,
): CheckResult {
  const reporter = new Reporter(`${workflowName}.yml`, new SourceMap(text));
  const view = readWorkflow(text, { reporter, workflowName });
  const diagnostics = reporter.diagnostics();
  const errors = diagnostics.length;
  const checkedView = errors === 0 && view ? view : null;
  return {
    errors,
    warnings: 0,
    infos: 0,
    view: checkedView,
    diagnostics,
    summary: {
      valid: errors === 0,
      counts: { stages: checkedView?.stages.length ?? 0 },
    },
  };
}

function readWorkflow(text: string, ctx: Context): WorkflowView | undefined {
  const { reporter } = ctx;
  const docs = parseDocuments(text);
  const failure = docs.flatMap((doc) => doc.errors)[0];
  if (failure) {
    const at = failure.pos[0];
    const message = `The text is not valid YAML (${failure.code}).`;
    reporter.report('YAML_SYNTAX', [], [at, at], message);
    return undefined;
  }
  const [first, ...others] = docs;
  const root = first?.contents;
  if (isMap(root)) reporter.nameStages(stageNamesOf(root));
  for (const found of findUnsupported(root)) {
    reporter.report('YAML_UNSUPPORTED', found.path, found.span, found.message);
  }
  for (const doc of others) {
    const message = 'Only one YAML document is allowed.';
    reporter.report('YAML_UNSUPPORTED', [], documentSpanOf(doc), message);
  }
  if (reporter.hasErrors()) return undefined;
  if (!isMap(root)) {
    const message = 'The workflow must be a mapping.';
    reporter.report('NOT_A_MAPPING', [], spanOf(root), message);
    return undefined;
  }
  return readTopLevel(root, ctx);
}

// The names that address stages in paths: usable, and not used before.
function stageNamesOf(root: YAMLMap): (string | undefined)[] {
  const stages = entriesOf(root).find((e) => e.keyText === 'stages')?.value;
  if (!isSeq(stages)) return [];
  const used = new Set<string>();
  return stages.items.map((item) => {
    const name = isMap(item) ? firstString(item, 'name') : undefined;
    if (name === undefined || !isUsableStageName(name) || used.has(name)) {
      return undefined;
    }
    used.add(name);
    return name;
  });
}

function firstString(map: YAMLMap, key: string): string | undefined {
  const value = entriesOf(map).find((e) => e.keyText === key)?.value;
  return isScalar(value) && typeof value.value === 'string'
    ? value.value
    : undefined;
}

function readTopLevel(root: YAMLMap, ctx: Context): WorkflowView {
  const entries = readEntries(root, [], TOP_KEYS, ctx);
  const format = readFormat(entries.get('format'), root, ctx);
  const version = readVersion(entries.get('version'), root, ctx);
  const name = readWorkflowName(entries.get('name'), ctx);
  const intent = readIntent(entries.get('intent'), root, ctx);
  const params = readParams(entries.get('params'), ctx);
  const stages = readStages(entries.get('stages'), root, ctx);
  return {
    format,
    version,
    name,
    intent,
    ...(params === undefined ? {} : { params }),
    stages,
  };
}

/**
 * The first entry of each key this build reads. A later repeat of any key is
 * a DUPLICATE_KEY. A first key of a later slice is named with its slice, and
 * a first key that no slice plans is an UNKNOWN_KEY.
 */
function readEntries(
  map: YAMLMap,
  path: Segment[],
  table: KeyTable,
  ctx: Context,
): Map<string, MapEntry> {
  const seen = new Set<string>();
  const entries = new Map<string, MapEntry>();
  const candidates = builtInKeys(table);
  for (const entry of entriesOf(map)) {
    const keyPath = [...path, entry.keyText];
    const keySpan = spanOf(entry.key);
    const slice = sliceOf(table, entry.keyText);
    if (seen.has(entry.keyText)) {
      const message = `The key ${quote(entry.keyText)} is already used.`;
      ctx.reporter.report('DUPLICATE_KEY', keyPath, keySpan, message);
    } else if (slice === undefined) {
      const message = `Unknown key ${quote(entry.keyText)}.`;
      const suggestion = suggestKey(entry.keyText, candidates);
      ctx.reporter.report('UNKNOWN_KEY', keyPath, keySpan, message, suggestion);
    } else if (isBuiltIn(slice)) {
      entries.set(entry.keyText, entry);
    } else {
      const message = `The key ${quote(entry.keyText)} is not supported by this build. ${laterSlice(slice)}`;
      ctx.reporter.report(
        'NOT_SUPPORTED_BY_THIS_BUILD',
        keyPath,
        keySpan,
        message,
      );
    }
    seen.add(entry.keyText);
  }
  return entries;
}

// The sentence that says which slice adds what this build lacks.
function laterSlice(slice: Slice): string {
  return `Slice ${slice} adds it.`;
}

// Names a key in a message only if it is short and plain. A longer key, or a
// key of 12 or more characters with a digit, may be an access key, a token or
// a hash, and is never echoed.
function quote(text: string): string {
  const plain = /^[\w.~-]{1,24}$/.test(text);
  const looksSecret = text.length >= 12 && /\d/.test(text);
  return plain && !looksSecret ? `\`${text}\`` : '(not shown)';
}

function reportMissing(
  map: YAMLMap,
  path: Segment[],
  key: string,
  ctx: Context,
  suggestion?: string,
): void {
  const message = `The mapping needs the key \`${key}\`.`;
  ctx.reporter.report('MISSING_KEY', path, spanOf(map), message, suggestion);
}

/** The string value of an entry, or `undefined` after a WRONG_TYPE. */
function readString(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): string | undefined {
  const { value } = entry;
  if (isScalar(value) && typeof value.value === 'string') return value.value;
  const message = `\`${entry.keyText}\` must be a string.`;
  ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
  return undefined;
}

/** A string that matches the name pattern, or `undefined` after a report. */
function readName(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): string | undefined {
  const text = readString(entry, path, ctx);
  if (text === undefined || isName(text)) return text;
  const message = `\`${entry.keyText}\` ${NAME_RULE}.`;
  ctx.reporter.report('INVALID_NAME', path, valueSpanOf(entry), message);
  return undefined;
}

/** A string that follows the path rules, or `undefined` after a report. */
function readPath(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): string | undefined {
  const text = readString(entry, path, ctx);
  if (text === undefined || PATH_PATTERN.test(text)) return text;
  const message = `\`${entry.keyText}\` must be a relative path that uses \`/\` and has no \`..\`.`;
  ctx.reporter.report('INVALID_VALUE', path, valueSpanOf(entry), message);
  return undefined;
}

function readFormat(
  entry: MapEntry | undefined,
  root: YAMLMap,
  ctx: Context,
): string {
  if (!entry) {
    reportMissing(root, [], 'format', ctx, `format: ${FORMAT}`);
    return '';
  }
  const text = readString(entry, ['format'], ctx);
  if (text !== undefined && text !== FORMAT) {
    const message = `This build reads the format \`${FORMAT}\` only.`;
    const span = valueSpanOf(entry);
    ctx.reporter.report('UNSUPPORTED_FORMAT', ['format'], span, message);
  }
  return text ?? '';
}

function readVersion(
  entry: MapEntry | undefined,
  root: YAMLMap,
  ctx: Context,
): string {
  if (!entry) {
    reportMissing(root, [], 'version', ctx);
    return '';
  }
  const text = readString(entry, ['version'], ctx);
  if (text !== undefined && !VERSION_PATTERN.test(text)) {
    const message =
      '`version` must be three numbers joined by dots, as in `0.1.0`.';
    const span = valueSpanOf(entry);
    ctx.reporter.report(
      'INVALID_VALUE',
      ['version'],
      span,
      message,
      SUGGESTED_VERSION,
    );
  }
  return text ?? '';
}

function readWorkflowName(entry: MapEntry | undefined, ctx: Context): string {
  if (!entry) return ctx.workflowName;
  const name = readName(entry, ['name'], ctx);
  if (name !== undefined && name !== ctx.workflowName) {
    const message = `\`name\` must be \`${ctx.workflowName}\`, the name of the file.`;
    ctx.reporter.report('NAME_MISMATCH', ['name'], valueSpanOf(entry), message);
  }
  return name ?? ctx.workflowName;
}

// The intent is a mapping with the outcome. The string form is planned.
function readIntent(
  entry: MapEntry | undefined,
  root: YAMLMap,
  ctx: Context,
): Intent {
  if (!entry) {
    reportMissing(root, [], 'intent', ctx);
    return { outcome: '' };
  }
  const { value } = entry;
  if (isMap(value)) return readIntentMapping(value, ctx);
  if (isScalar(value) && typeof value.value === 'string') {
    const message = `The string form of \`intent\` is not supported by this build. ${laterSlice(INTENT_STRING_SLICE)}`;
    const span = valueSpanOf(entry);
    ctx.reporter.report(
      'NOT_SUPPORTED_BY_THIS_BUILD',
      ['intent'],
      span,
      message,
    );
  } else {
    const message = '`intent` must be a mapping with an `outcome`.';
    ctx.reporter.report('WRONG_TYPE', ['intent'], valueSpanOf(entry), message);
  }
  return { outcome: '' };
}

function readIntentMapping(map: YAMLMap, ctx: Context): Intent {
  const entries = readEntries(map, ['intent'], INTENT_KEYS, ctx);
  const outcomeEntry = entries.get('outcome');
  if (!outcomeEntry) reportMissing(map, ['intent'], 'outcome', ctx);
  const outcome = outcomeEntry
    ? readOutcome(outcomeEntry, ['intent', 'outcome'], ctx)
    : '';
  const accept = readAccept(entries.get('accept'), ctx);
  return accept === undefined ? { outcome } : { outcome, accept };
}

function readOutcome(entry: MapEntry, path: Segment[], ctx: Context): string {
  const text = readString(entry, path, ctx);
  if (text === undefined) return '';
  const problem = outcomeProblem(text);
  if (problem) {
    const message = `\`${entry.keyText}\` ${problem}.`;
    ctx.reporter.report('INVALID_VALUE', path, valueSpanOf(entry), message);
  }
  return text;
}

function outcomeProblem(text: string): string | undefined {
  if (text === '') return 'must not be empty';
  if (/[\r\n]/.test(text)) return 'must be one line';
  if (codePointLength(text) > MAX_INTENT_CHARS) {
    return `must have at most ${MAX_INTENT_CHARS} characters`;
  }
  return undefined;
}

function readAccept(
  entry: MapEntry | undefined,
  ctx: Context,
): Check[] | undefined {
  if (!entry) return undefined;
  const path = ['intent', 'accept'];
  if (!isSeq(entry.value)) {
    const message = '`accept` must be a list of checks.';
    ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
    return undefined;
  }
  const used = new Set<string>();
  return entry.value.items.flatMap((item, index) => {
    const check = readCheck(item, [...path, index], used, ctx);
    return check ? [check] : [];
  });
}

// A check has an id and exactly one of `file` and `run`. This build reads
// `file`, and `run` is named as a later key.
function readCheck(
  item: unknown,
  path: Segment[],
  used: Set<string>,
  ctx: Context,
): Check | undefined {
  if (!isMap(item)) {
    const message = 'A check must be a mapping.';
    ctx.reporter.report('WRONG_TYPE', path, spanOf(item), message);
    return undefined;
  }
  const entries = readEntries(item, path, CHECK_KEYS, ctx);
  const idEntry = entries.get('id');
  if (!idEntry) reportMissing(item, path, 'id', ctx);
  const id = idEntry && readCheckId(idEntry, [...path, 'id'], used, ctx);
  const fileEntry = entries.get('file');
  const file = fileEntry && readPath(fileEntry, [...path, 'file'], ctx);
  const hasRun = entriesOf(item).some((e) => e.keyText === 'run');
  if ((fileEntry !== undefined) === hasRun) {
    const message = 'A check needs exactly one of `file` and `run`.';
    ctx.reporter.report('INVALID_VALUE', path, spanOf(item), message);
  }
  return id && file ? { id, file } : undefined;
}

function readCheckId(
  entry: MapEntry,
  path: Segment[],
  used: Set<string>,
  ctx: Context,
): string | undefined {
  const id = readName(entry, path, ctx);
  if (id === undefined) return undefined;
  if (used.has(id)) {
    const message = `The check id \`${id}\` is already used.`;
    ctx.reporter.report('INVALID_VALUE', path, valueSpanOf(entry), message);
    return undefined;
  }
  used.add(id);
  return id;
}

// `params` holds the goal. A param with another name is a later key.
function readParams(
  entry: MapEntry | undefined,
  ctx: Context,
): Record<string, Param> | undefined {
  if (!entry) return undefined;
  if (!isMap(entry.value)) {
    const message = '`params` must be a mapping of names to params.';
    ctx.reporter.report('WRONG_TYPE', ['params'], valueSpanOf(entry), message);
    return undefined;
  }
  const entries = readEntries(entry.value, ['params'], PARAMS_KEYS, ctx);
  const goal = entries.get('goal');
  return goal ? { goal: readGoal(goal, ctx) } : {};
}

function readGoal(entry: MapEntry, ctx: Context): Param {
  const path = ['params', 'goal'];
  if (!isMap(entry.value)) {
    const message = '`goal` must be a mapping.';
    ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
    return {};
  }
  const entries = readEntries(entry.value, path, GOAL_KEYS, ctx);
  const param: Param = {};
  for (const key of ['description', 'default'] as const) {
    const found = entries.get(key);
    const text = found && readString(found, [...path, key], ctx);
    if (text !== undefined) param[key] = text;
  }
  return param;
}

function readStages(
  entry: MapEntry | undefined,
  root: YAMLMap,
  ctx: Context,
): Stage[] {
  if (!entry) {
    reportMissing(root, [], 'stages', ctx);
    return [];
  }
  const list = entry.value;
  if (!isSeq(list)) {
    const message = '`stages` must be a list.';
    ctx.reporter.report('WRONG_TYPE', ['stages'], valueSpanOf(entry), message);
    return [];
  }
  if (list.items.length < 1 || list.items.length > MAX_STAGES) {
    const message = `\`stages\` must have 1 to ${MAX_STAGES} entries.`;
    ctx.reporter.report('INVALID_VALUE', ['stages'], spanOf(list), message);
  }
  const used = new Set<string>();
  return list.items.flatMap((item, index) => {
    const stage = readStage(item, index, used, ctx);
    return stage ? [stage] : [];
  });
}

function readStage(
  item: unknown,
  index: number,
  used: Set<string>,
  ctx: Context,
): Stage | undefined {
  const path = ['stages', index];
  if (!isMap(item)) {
    const message = 'A stage must be a mapping.';
    ctx.reporter.report('NOT_A_MAPPING', path, spanOf(item), message);
    return undefined;
  }
  const entries = readEntries(item, path, STAGE_KEYS, ctx);
  checkStageKind(item, path, ctx);
  const nameEntry = entries.get('name');
  if (!nameEntry) reportMissing(item, path, 'name', ctx);
  const name = nameEntry && readStageName(nameEntry, path, used, ctx);
  const agentEntry = entries.get('agent');
  const agent = agentEntry && readName(agentEntry, [...path, 'agent'], ctx);
  const prompts = readPrompts(entries, path, ctx);
  return name && agent ? { name, agent, ...prompts } : undefined;
}

// A stage has exactly one key that names its kind. A kind of a later slice
// counts here, and is named as a later key by `readEntries`.
function checkStageKind(item: YAMLMap, path: Segment[], ctx: Context): void {
  const kinds = new Set(
    entriesOf(item)
      .map((e) => e.keyText)
      .filter(isStageKind),
  );
  if (kinds.size === 0) {
    const message = 'A stage needs a key for its kind. This build has `agent`.';
    ctx.reporter.report('STAGE_KIND_MISSING', path, spanOf(item), message);
  } else if (kinds.size > 1) {
    const message = 'A stage can have only one key for its kind.';
    ctx.reporter.report('STAGE_KIND_AMBIGUOUS', path, spanOf(item), message);
  }
}

function readStageName(
  entry: MapEntry,
  path: Segment[],
  used: Set<string>,
  ctx: Context,
): string | undefined {
  const namePath = [...path, 'name'];
  const name = readName(entry, namePath, ctx);
  if (name === undefined) return undefined;
  const span = valueSpanOf(entry);
  if (RESERVED_STAGE_NAMES.has(name)) {
    const message = `The stage name \`${name}\` is reserved.`;
    ctx.reporter.report('RESERVED_NAME', namePath, span, message);
    return undefined;
  }
  if (used.has(name)) {
    const message = `The stage name \`${name}\` is already used.`;
    ctx.reporter.report('DUPLICATE_STAGE', namePath, span, message);
    return undefined;
  }
  used.add(name);
  return name;
}

// `prompt` is text. `prompt_file` is a path, and this check looks at the path
// only: it never reads the file (see the contract).
function readPrompts(
  entries: Map<string, MapEntry>,
  path: Segment[],
  ctx: Context,
): Pick<Stage, 'prompt' | 'prompt_file'> {
  const promptEntry = entries.get('prompt');
  const fileEntry = entries.get('prompt_file');
  const prompt =
    promptEntry && readPrompt(promptEntry, [...path, 'prompt'], ctx);
  const promptFile =
    fileEntry && readPath(fileEntry, [...path, 'prompt_file'], ctx);
  if (promptEntry && fileEntry) {
    const message = 'Set `prompt` or `prompt_file`, not both.';
    const span = valueSpanOf(fileEntry);
    ctx.reporter.report(
      'INVALID_VALUE',
      [...path, 'prompt_file'],
      span,
      message,
    );
  }
  return {
    ...(prompt === undefined ? {} : { prompt }),
    ...(promptFile === undefined ? {} : { prompt_file: promptFile }),
  };
}

function readPrompt(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): string | undefined {
  const text = readString(entry, path, ctx);
  if (text === undefined) return undefined;
  const length = codePointLength(text);
  const span = valueSpanOf(entry);
  if (length < 1 || length > MAX_PROMPT_CHARS) {
    const message = `\`prompt\` must have 1 to ${MAX_PROMPT_CHARS} characters.`;
    ctx.reporter.report('INVALID_VALUE', path, span, message);
  } else if (REFERENCE_PATTERN.test(text)) {
    const message = `A reference such as \`{plan.design}\` is not supported by this build. ${laterSlice(REFERENCE_SLICE)}`;
    ctx.reporter.report('NOT_SUPPORTED_BY_THIS_BUILD', path, span, message);
  }
  return text;
}
