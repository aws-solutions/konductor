// SPDX-License-Identifier: Apache-2.0
import { isMap, isScalar, isSeq, type YAMLMap } from 'yaml';
import {
  isName,
  isUsableStageName,
  MAX_INTENT_CHARS,
  MAX_STAGES,
  RESERVED_STAGE_NAMES,
} from './contract.ts';
import { Reporter, type Segment } from './diagnostics.ts';
import type { CheckResult, Stage, WorkflowView } from './model.ts';
import { SourceMap } from './source-map.ts';
import { suggestKey } from './suggest.ts';
import {
  entriesOf,
  findUnsupported,
  parseDocuments,
  spanOf,
  valueSpanOf,
  type MapEntry,
} from './yaml-subset.ts';

const TOP_KEYS = ['version', 'name', 'intent', 'stages'];
const INTENT_KEYS = ['outcome'];
const STAGE_KEYS = ['name', 'agent'];
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
    reporter.report('YAML_UNSUPPORTED', [], spanOf(doc), message);
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
  const version = entries.get('version');
  if (version) checkVersion(version, ctx);
  const name = readWorkflowName(entries.get('name'), ctx);
  const outcome = readIntent(entries.get('intent'), root, ctx);
  const stages = readStages(entries.get('stages'), root, ctx);
  return { name, intent: { outcome }, stages };
}

/**
 * The first entry of each known key. A later repeat of any key is a
 * DUPLICATE_KEY, and a first key that is not known is an UNKNOWN_KEY.
 */
function readEntries(
  map: YAMLMap,
  path: Segment[],
  known: readonly string[],
  ctx: Context,
): Map<string, MapEntry> {
  const seen = new Set<string>();
  const entries = new Map<string, MapEntry>();
  for (const entry of entriesOf(map)) {
    const keyPath = [...path, entry.keyText];
    const keySpan = spanOf(entry.key);
    if (seen.has(entry.keyText)) {
      const message = `The key ${quote(entry.keyText)} is already used.`;
      ctx.reporter.report('DUPLICATE_KEY', keyPath, keySpan, message);
    } else if (known.includes(entry.keyText)) {
      entries.set(entry.keyText, entry);
    } else {
      const message = `Unknown key ${quote(entry.keyText)}.`;
      const suggestion = suggestKey(entry.keyText, known);
      ctx.reporter.report('UNKNOWN_KEY', keyPath, keySpan, message, suggestion);
    }
    seen.add(entry.keyText);
  }
  return entries;
}

// Names a key in a message, unless it is long or odd enough to be a secret.
function quote(text: string): string {
  return /^[\w.~-]{1,32}$/.test(text) ? `\`${text}\`` : '(not shown)';
}

function reportMissing(
  map: YAMLMap,
  path: Segment[],
  key: string,
  ctx: Context,
): void {
  const message = `The mapping needs the key \`${key}\`.`;
  ctx.reporter.report('MISSING_KEY', path, spanOf(map), message);
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

function checkVersion(entry: MapEntry, ctx: Context): void {
  const text = readString(entry, ['version'], ctx);
  if (text === undefined || text === '1.1') return;
  const message = "`version` must be the string '1.1'.";
  ctx.reporter.report(
    'INVALID_VALUE',
    ['version'],
    valueSpanOf(entry),
    message,
  );
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

// The intent is one line of text, or a mapping that holds it as `outcome`.
function readIntent(
  entry: MapEntry | undefined,
  root: YAMLMap,
  ctx: Context,
): string {
  if (!entry) {
    reportMissing(root, [], 'intent', ctx);
    return '';
  }
  if (!isMap(entry.value)) return readOutcome(entry, ['intent'], ctx);
  const entries = readEntries(entry.value, ['intent'], INTENT_KEYS, ctx);
  const outcome = entries.get('outcome');
  if (outcome) return readOutcome(outcome, ['intent', 'outcome'], ctx);
  reportMissing(entry.value, ['intent'], 'outcome', ctx);
  return '';
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
  if ([...text].length > MAX_INTENT_CHARS) {
    return `must have at most ${MAX_INTENT_CHARS} characters`;
  }
  return undefined;
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
  const nameEntry = entries.get('name');
  const agentEntry = entries.get('agent');
  if (!nameEntry) reportMissing(item, path, 'name', ctx);
  if (!agentEntry) reportMissing(item, path, 'agent', ctx);
  const name = nameEntry && readStageName(nameEntry, path, used, ctx);
  const agent = agentEntry && readName(agentEntry, [...path, 'agent'], ctx);
  return name && agent ? { name, agent } : undefined;
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
