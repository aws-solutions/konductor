// SPDX-License-Identifier: Apache-2.0
import { isMap, isScalar, isSeq, Scalar, type YAMLMap } from 'yaml';
import {
  codePointLength,
  FORMAT,
  isName,
  isOutputName,
  isParamName,
  isShowable,
  isUsableStageName,
  MAX_INTENT_CHARS,
  MAX_PARAM_CHARS,
  MIN_RUN_ARGV,
  MAX_PROMPT_CHARS,
  MAX_STAGES,
  MAX_YAML_DEPTH,
  PATH_PATTERN,
  quoteValue,
  RESERVED_STAGE_NAMES,
  SUGGESTED_VERSION,
  VERSION_PATTERN,
} from './contract.ts';
import { Reporter, type Segment, type Span } from './diagnostics.ts';
import {
  builtInKeys,
  CHECK_KEYS,
  GOAL_KEYS,
  INTENT_KEYS,
  INTENT_STRING_SLICE,
  isBuiltIn,
  isStageKind,
  OUTPUT_KEYS,
  PARAM_KEYS,
  PARAM_TYPE_SLICE,
  PARAMS_KEYS,
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
  LineRange,
  Param,
  Stage,
  WorkflowView,
} from './model.ts';
import {
  isRunReference,
  offsetInSource,
  referencesIn,
  type Reference,
} from './references.ts';
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
const OUTPUT_NAME_RULE =
  'must be lower-case letters, digits and hyphens, start with a letter, and have at most 64 characters';
const PARAM_NAME_RULE =
  'must be lower-case letters, digits and underscores, start with a letter, and have at most 64 characters';
// The escape for literal text that matches the reference pattern has no
// syntax yet, so there is no way to write such text. The public rules keep
// this interim answer until one arrives.
const ESCAPE_RULE =
  'There is no way to write that text yet: the escape for it is not defined.';

interface Context {
  reporter: Reporter;
  workflowName: string;
  source: SourceMap;
}

/**
 * Checks the text of a workflow and reports every problem it finds. The view
 * is `null` when there is an error.
 */
export function checkWorkflowText(
  text: string,
  workflowName: string,
): CheckResult {
  const source = new SourceMap(text);
  const reporter = new Reporter(`${workflowName}.yml`, source);
  const view = readWorkflow(text, { reporter, workflowName, source });
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
    // The parser gives up on a stack overflow, which only text nested far
    // beyond the limit causes, so it is the depth rule and not a syntax error.
    if (failure.code === 'RESOURCE_EXHAUSTION') {
      const message = `YAML nested deeper than ${MAX_YAML_DEPTH} levels is not allowed.`;
      reporter.report('YAML_UNSUPPORTED', [], [at, at], message);
      return undefined;
    }
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
  const { intent, checkIds } = readIntent(entries.get('intent'), root, ctx);
  const params = readParams(entries.get('params'), ctx);
  const stages = readStages(
    entries.get('stages'),
    root,
    { params, checkIds },
    ctx,
  );
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
      const message = `The key ${quoteValue(entry.keyText)} is already used.`;
      ctx.reporter.report('DUPLICATE_KEY', keyPath, keySpan, message);
    } else if (slice === undefined) {
      const message = `Unknown key ${quoteValue(entry.keyText)}.`;
      const suggestion = suggestKey(entry.keyText, candidates);
      ctx.reporter.report('UNKNOWN_KEY', keyPath, keySpan, message, suggestion);
    } else if (isBuiltIn(slice)) {
      entries.set(entry.keyText, entry);
    } else {
      const message = `The key ${quoteValue(entry.keyText)} is not supported by this build. ${laterSlice(slice)}`;
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

/**
 * How a key is named in a message. A static key of the format is safe to
 * echo; a key the author chose, such as a param or an output name, is passed
 * through `quoteValue` first.
 */
function labelOf(entry: MapEntry, label?: string): string {
  return label ?? `\`${entry.keyText}\``;
}

/** The string value of an entry, or `undefined` after a WRONG_TYPE. */
function readString(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
  label?: string,
): string | undefined {
  const { value } = entry;
  if (isScalar(value) && typeof value.value === 'string') return value.value;
  const message = `${labelOf(entry, label)} must be a string.`;
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

/** The boolean value of an entry, or `undefined` after a WRONG_TYPE. */
function readBoolean(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): boolean | undefined {
  const { value } = entry;
  if (isScalar(value) && typeof value.value === 'boolean') return value.value;
  const message = `\`${entry.keyText}\` must be \`true\` or \`false\`.`;
  ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
  return undefined;
}

/** A string that follows the path rules, or `undefined` after a report. */
function readPath(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
  label?: string,
): string | undefined {
  const text = readString(entry, path, ctx, label);
  if (text === undefined || PATH_PATTERN.test(text)) return text;
  const message = `${labelOf(entry, label)} must be a relative path of segments joined by \`/\`, with no empty, \`.\` or \`..\` segment, no \`\\\`, no drive letter and no control character.`;
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

/** The intent, and the check ids the file declares for `done_when` to name. */
interface ReadIntent {
  intent: Intent;
  checkIds: ReadonlySet<string>;
}

const NO_INTENT: ReadIntent = { intent: { outcome: '' }, checkIds: new Set() };

// The intent is a mapping with the outcome. The string form is planned.
function readIntent(
  entry: MapEntry | undefined,
  root: YAMLMap,
  ctx: Context,
): ReadIntent {
  if (!entry) {
    reportMissing(root, [], 'intent', ctx);
    return NO_INTENT;
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
  return NO_INTENT;
}

function readIntentMapping(map: YAMLMap, ctx: Context): ReadIntent {
  const entries = readEntries(map, ['intent'], INTENT_KEYS, ctx);
  const outcomeEntry = entries.get('outcome');
  if (!outcomeEntry) reportMissing(map, ['intent'], 'outcome', ctx);
  const outcome = outcomeEntry
    ? readOutcome(outcomeEntry, ['intent', 'outcome'], ctx)
    : '';
  // Every id the file declares, a check whose value had a problem of its own
  // included, so a `done_when` that names it is not reported a second time.
  const checkIds = new Set<string>();
  const accept = readAccept(entries.get('accept'), checkIds, ctx);
  const intent = accept === undefined ? { outcome } : { outcome, accept };
  return { intent, checkIds };
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
  used: Set<string>,
  ctx: Context,
): Check[] | undefined {
  if (!entry) return undefined;
  const path = ['intent', 'accept'];
  if (!isSeq(entry.value)) {
    const message = '`accept` must be a list of checks.';
    ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
    return undefined;
  }
  return entry.value.items.flatMap((item, index) => {
    const check = readCheck(item, [...path, index], used, ctx);
    return check ? [check] : [];
  });
}

// A check has an id and exactly one of `file` and `run`.
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
  const runEntry = entries.get('run');
  const run = runEntry && readArgv(runEntry, [...path, 'run'], ctx);
  if ((fileEntry !== undefined) === (runEntry !== undefined)) {
    const message = 'A check needs exactly one of `file` and `run`.';
    ctx.reporter.report('INVALID_VALUE', path, spanOf(item), message);
  }
  if (id === undefined) return undefined;
  if (file !== undefined) return { id, file };
  return run === undefined ? undefined : { id, run };
}

// A `run` check is a command and its arguments, with at least one entry. The
// stub never runs it: it reads the declaration only.
function readArgv(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): string[] | undefined {
  const list = entry.value;
  if (!isSeq(list)) {
    const message = '`run` must be a list of strings.';
    ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
    return undefined;
  }
  if (list.items.length < MIN_RUN_ARGV) {
    const message = `\`run\` must have at least ${MIN_RUN_ARGV} entry.`;
    ctx.reporter.report('INVALID_VALUE', path, spanOf(list), message);
    return undefined;
  }
  const words = list.items.map((item, index) =>
    readWord(item, [...path, index], ctx),
  );
  return words.every((word) => word !== undefined) ? words : undefined;
}

// One word of a `run` command, or one id of a `done_when`, as it is written
// in the list. A list entry has no key, so the label says what it is.
function readWord(
  item: unknown,
  path: Segment[],
  ctx: Context,
  label = '`run`',
): string | undefined {
  if (isScalar(item) && typeof item.value === 'string') return item.value;
  const message = `Every entry of ${label} must be a string.`;
  ctx.reporter.report('WRONG_TYPE', path, spanOf(item), message);
  return undefined;
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

// `params` holds the goal and any other param the file declares. The goal
// takes a description and a default; another param also takes a type and
// whether it is required.
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
  const params: Record<string, Param> = {};
  for (const [name, found] of entries) {
    if (name === 'goal') {
      params.goal = readGoal(found, ctx);
    } else if (readParamName(found, name, ctx)) {
      params[name] = readParam(found, name, ctx);
    }
  }
  return params;
}

// A param name is checked at its key, where the author wrote it.
function readParamName(entry: MapEntry, name: string, ctx: Context): boolean {
  if (isParamName(name)) return true;
  const message = `The param name ${quoteValue(name)} ${PARAM_NAME_RULE}.`;
  const path = ['params', name];
  ctx.reporter.report('INVALID_NAME', path, spanOf(entry.key), message);
  return false;
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
  checkDefaultLength(entries.get('default'), path, ctx);
  return param;
}

function readParam(entry: MapEntry, name: string, ctx: Context): Param {
  const path = ['params', name];
  const label = quoteValue(name);
  if (!isMap(entry.value)) {
    const message = `${label} must be a mapping.`;
    ctx.reporter.report('WRONG_TYPE', path, valueSpanOf(entry), message);
    return {};
  }
  const entries = readEntries(entry.value, path, PARAM_KEYS, ctx);
  const param: Param = {};
  const type = entries.get('type');
  if (type) {
    const read = readParamType(type, [...path, 'type'], ctx);
    if (read !== undefined) param.type = read;
  }
  for (const key of ['description', 'default'] as const) {
    const found = entries.get(key);
    const text = found && readString(found, [...path, key], ctx);
    if (text !== undefined) param[key] = text;
  }
  checkDefaultLength(entries.get('default'), path, ctx);
  const required = entries.get('required');
  if (required) {
    const read = readBoolean(required, [...path, 'required'], ctx);
    if (read !== undefined) param.required = read;
  }
  return param;
}

// Every value is a string in this release; the other types are planned.
function readParamType(
  entry: MapEntry,
  path: Segment[],
  ctx: Context,
): 'string' | undefined {
  const text = readString(entry, path, ctx);
  if (text === undefined) return undefined;
  if (text === 'string') return 'string';
  const message = `The param type ${quoteValue(text)} is not supported by this build. ${laterSlice(PARAM_TYPE_SLICE)}`;
  const span = valueSpanOf(entry);
  ctx.reporter.report('NOT_SUPPORTED_BY_THIS_BUILD', path, span, message);
  return undefined;
}

// A param's `default` is a value the run takes, so it is held to the same
// limit as a value sent with the run.
function checkDefaultLength(
  entry: MapEntry | undefined,
  path: Segment[],
  ctx: Context,
): void {
  if (!entry || !isScalar(entry.value)) return;
  const text = entry.value.value;
  if (typeof text !== 'string') return;
  if (codePointLength(text) <= MAX_PARAM_CHARS) return;
  const message = `\`default\` must have at most ${MAX_PARAM_CHARS} characters.`;
  const span = valueSpanOf(entry);
  ctx.reporter.report('INVALID_VALUE', [...path, 'default'], span, message);
}

/** What a stage is read against: the declared params and check ids. */
interface Declared {
  params: Record<string, Param> | undefined;
  checkIds: ReadonlySet<string>;
}

function readStages(
  entry: MapEntry | undefined,
  root: YAMLMap,
  declared: Declared,
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
  const read = list.items.flatMap((item, index) => {
    const stage = readStage(item, index, used, declared.checkIds, ctx);
    return stage ? [stage] : [];
  });
  checkReferences(read, declared.params, ctx);
  return read.map(({ stage }) => stage);
}

/** A stage and the prompt entry its references were written in. */
interface ReadStage {
  stage: Stage;
  index: number;
  prompt?: MapEntry;
}

function readStage(
  item: unknown,
  index: number,
  used: Set<string>,
  checkIds: ReadonlySet<string>,
  ctx: Context,
): ReadStage | undefined {
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
  const outputs = readOutputs(entries.get('outputs'), path, ctx);
  const doneWhen = readDoneWhen(entries.get('done_when'), path, checkIds, ctx);
  if (!name || !agent) return undefined;
  const range = lineRangeOf(item, ctx.source);
  const stage: Stage = {
    name,
    kind: 'agent',
    agent,
    ...prompts,
    ...(outputs === undefined ? {} : { outputs }),
    ...(doneWhen === undefined ? {} : { done_when: doneWhen }),
    range,
  };
  const prompt = entries.get('prompt');
  return { stage, index, ...(prompt === undefined ? {} : { prompt }) };
}

// `outputs` maps an output name to a file the stage must leave behind. The
// name is checked at its key and the path by the path rules.
function readOutputs(
  entry: MapEntry | undefined,
  path: Segment[],
  ctx: Context,
): Record<string, string> | undefined {
  if (!entry) return undefined;
  const outputsPath = [...path, 'outputs'];
  if (!isMap(entry.value)) {
    const message = '`outputs` must be a mapping of names to paths.';
    const span = valueSpanOf(entry);
    ctx.reporter.report('WRONG_TYPE', outputsPath, span, message);
    return undefined;
  }
  const entries = readEntries(entry.value, outputsPath, OUTPUT_KEYS, ctx);
  const outputs: Record<string, string> = {};
  for (const [name, found] of entries) {
    if (!isOutputName(name)) {
      const message = `The output name ${quoteValue(name)} ${OUTPUT_NAME_RULE}.`;
      const span = spanOf(found.key);
      ctx.reporter.report(
        'INVALID_NAME',
        [...outputsPath, name],
        span,
        message,
      );
      continue;
    }
    const file = readPath(found, [...outputsPath, name], ctx, quoteValue(name));
    if (file !== undefined) outputs[name] = file;
  }
  return outputs;
}

// `done_when` lists the check ids that must pass before the stage does. An id
// that is no check of `intent.accept` is reported at the entry: the stage
// would wait for a check that the file never declares.
function readDoneWhen(
  entry: MapEntry | undefined,
  path: Segment[],
  checkIds: ReadonlySet<string>,
  ctx: Context,
): string[] | undefined {
  if (!entry) return undefined;
  const donePath = [...path, 'done_when'];
  const list = entry.value;
  if (!isSeq(list)) {
    const message = '`done_when` must be a list of check ids.';
    ctx.reporter.report('WRONG_TYPE', donePath, valueSpanOf(entry), message);
    return undefined;
  }
  const ids = list.items.flatMap((item, index) => {
    const at = [...donePath, index];
    const id = readWord(item, at, ctx, '`done_when`');
    if (id === undefined) return [];
    if (!isName(id)) {
      const message = `A check id ${NAME_RULE}.`;
      ctx.reporter.report('INVALID_NAME', at, spanOf(item), message);
      return [];
    }
    if (!checkIds.has(id)) {
      const message = `There is no check with the id ${quoteValue(id)} in \`intent.accept\`.`;
      ctx.reporter.report('INVALID_VALUE', at, spanOf(item), message);
      return [];
    }
    return [id];
  });
  return ids;
}

// From the line of the stage's first key to the last line that holds its text.
// A block scalar ends where its value ends, so the blank lines that `|+` keeps
// stay in the range.
function lineRangeOf(item: YAMLMap, source: SourceMap): LineRange {
  const [start, end] = spanOf(item);
  const block = lastBlockScalarEnd(item);
  let last = block ?? end;
  if (block === undefined) {
    const text = source.text;
    while (last > start && /\s/.test(text.charAt(last - 1))) last--;
  }
  return {
    line: source.position(start).line,
    end_line: source.position(Math.max(start, last - 1)).line,
  };
}

// The end of the last value of a block-style stage, when that value is a
// block scalar.
function lastBlockScalarEnd(item: YAMLMap): number | undefined {
  if (item.flow) return undefined;
  const value = item.items.at(-1)?.value;
  if (!isScalar(value) || !value.range) return undefined;
  const isBlock =
    value.type === Scalar.BLOCK_LITERAL || value.type === Scalar.BLOCK_FOLDED;
  return isBlock ? value.range[1] : undefined;
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
  if (length < 1 || length > MAX_PROMPT_CHARS) {
    const message = `\`prompt\` must have 1 to ${MAX_PROMPT_CHARS} characters.`;
    ctx.reporter.report('INVALID_VALUE', path, valueSpanOf(entry), message);
  }
  return text;
}

/**
 * Checks every reference in every prompt. `{run.<param>}` names a param of
 * the run, and `{<stage>.<output>}` an output of that stage or an earlier
 * one. A reference the file does not declare is an `INVALID_VALUE` at the
 * reference, which is where the author can fix it.
 */
function checkReferences(
  read: readonly ReadStage[],
  params: Record<string, Param> | undefined,
  ctx: Context,
): void {
  const outputsBefore = new Map<string, Set<string>>();
  const stagesAhead = new Set(read.map(({ stage }) => stage.name));
  for (const { stage, index, prompt } of read) {
    outputsBefore.set(stage.name, new Set(Object.keys(stage.outputs ?? {})));
    stagesAhead.delete(stage.name);
    if (!prompt) continue;
    const text = isScalar(prompt.value) ? prompt.value.value : undefined;
    if (typeof text !== 'string') continue;
    const path = ['stages', index, 'prompt'];
    const seen = new Map<string, number>();
    for (const reference of referencesIn(text)) {
      const skip = seen.get(reference.text) ?? 0;
      seen.set(reference.text, skip + 1);
      const problem = referenceProblem(
        reference,
        params,
        outputsBefore,
        stagesAhead,
      );
      if (problem === undefined) continue;
      const span = spanOfReference(prompt, reference, skip, ctx);
      ctx.reporter.report(problem.code, path, span, problem.message);
    }
  }
}

/** Why a reference cannot be read, and the code that says so. */
interface ReferenceProblem {
  code: 'INVALID_VALUE' | 'NOT_SUPPORTED_BY_THIS_BUILD';
  message: string;
}

/**
 * What is wrong with a reference, or `undefined` when it resolves.
 *
 * A scope that is neither `run` nor a stage of the file names no input at
 * all, so the text is literal text that happens to match the reference
 * pattern. There is no way to write that yet, since the escape for it is
 * still open, so it is `NOT_SUPPORTED_BY_THIS_BUILD` rather than a reference
 * that points at the wrong thing.
 */
function referenceProblem(
  reference: Reference,
  params: Record<string, Param> | undefined,
  outputsBefore: ReadonlyMap<string, ReadonlySet<string>>,
  stagesAhead: ReadonlySet<string>,
): ReferenceProblem | undefined {
  const { scope, name } = reference;
  const shown = quoteReference(reference);
  const wrong = (message: string): ReferenceProblem => ({
    code: 'INVALID_VALUE',
    message,
  });
  if (isRunReference(reference)) {
    // The goal is a param of every run, declared or not. An own-key check, so
    // an inherited name such as `constructor` is not taken as declared.
    const declared = name === 'goal' || Object.hasOwn(params ?? {}, name);
    return declared
      ? undefined
      : wrong(`${shown} names a param that the file does not declare.`);
  }
  if (stagesAhead.has(scope)) {
    return wrong(
      `${shown} names a stage that runs later. A stage can name only its own outputs and those of an earlier stage.`,
    );
  }
  const outputs = outputsBefore.get(scope);
  if (!outputs) {
    return {
      code: 'NOT_SUPPORTED_BY_THIS_BUILD',
      message: `${shown} is neither a param of the run nor an output of a stage of this workflow, so it is text that matches the reference pattern. ${ESCAPE_RULE}`,
    };
  }
  return outputs.has(name)
    ? undefined
    : wrong(
        `${shown} names an output that the stage ${quoteValue(scope)} does not declare.`,
      );
}

// A reference is echoed only when both of its names are plain, since a
// message never quotes a value that looks like a secret.
function quoteReference(reference: Reference): string {
  const plain = isShowable(reference.scope) && isShowable(reference.name);
  return plain ? `\`${reference.text}\`` : 'The reference (not shown)';
}

// Where the reference sits in the text. A quoted scalar may escape what it
// holds, so a reference the source does not spell out is reported at the
// whole prompt instead.
function spanOfReference(
  prompt: MapEntry,
  reference: Reference,
  skip: number,
  ctx: Context,
): Span {
  const [start, end] = valueSpanOf(prompt);
  const source = ctx.source.text.slice(start, end);
  const at = offsetInSource(source, reference, skip);
  if (at === undefined) return [start, end];
  return [start + at, start + at + reference.text.length];
}
