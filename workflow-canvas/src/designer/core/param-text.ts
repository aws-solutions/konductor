// SPDX-License-Identifier: Apache-2.0
import { scalar } from './scalar-text';
import type { Written } from './stage-text';

interface ParamSnapshot {
  readonly name: string;
  readonly description?: string;
  readonly default?: string;
  readonly required?: boolean;
}

/** One parameter declaration the editor asks the writer to keep. */
export interface ParamToWrite {
  readonly name: string;
  readonly description: string;
  readonly default: string;
  readonly required: boolean;
  readonly from?: number;
  readonly before?: ParamSnapshot;
}

type Line = { text: string; eol: string };
type Field = { line: number; start: number; end: number };

interface ParamItem {
  readonly name: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly lead: Line[];
  readonly body: Line[];
  readonly fields: ReadonlyMap<string, Field>;
  readonly emptyFlow: boolean;
}

interface Plan {
  readonly lines: Line[];
  readonly key: number;
  readonly next: number;
  readonly items: readonly ParamItem[];
  readonly rest: readonly Line[];
  readonly eol: string;
}

const FLOW_REASON =
  'The params mapping uses flow style, so the editor cannot change it byte for byte. Make the change in a text editor.';
const QUOTED_REASON =
  'The params mapping quotes a parameter or known field key, so the editor cannot change it byte for byte. Make the change in a text editor.';
const METADATA_REASON =
  'The params mapping uses an anchor, alias or tag, so the editor cannot change it byte for byte. Make the change in a text editor.';
const DUPLICATE_REASON =
  'The params mapping has a duplicate parameter or field key, so the editor cannot change it safely. Make the change in a text editor.';
const LAYOUT_REASON =
  'The params mapping is not a block with one parameter and field per line, so the editor cannot change it byte for byte. Make the change in a text editor.';

const PARAMS_KEY = /^params:[ \t]*(?:#.*)?$/;
const ANY_PARAMS_KEY = /^(?:params|"params"|'params')[ \t]*:/;
const QUOTED_PARAMS_KEY = /^(?:"params"|'params')[ \t]*:/;
const STAGES_KEY = /^(?:stages|"stages"|'stages'):[ \t]*(?:#.*)?$/;
const TOP_LEVEL = /^(?:[^\s#-]|---|\.\.\.)/;
const PARAM_HEADER = /^  ([a-z][a-z0-9_]{0,63})[ \t]*:[ \t]*(.*)$/;
const QUOTED_PARAM = /^  (?:(?:"(?:\\.|[^"])*")|'[^']*')[ \t]*:/;
const FIELD = /^    (type|description|default|required)[ \t]*:[ \t]*(.*)$/;
const QUOTED_FIELD = /^    (?:(?:"(?:\\.|[^"])*")|'[^']*')[ \t]*:/;
const FILLER = /^[ \t]*(?:#.*)?$/;
const METADATA = /^[ \t]*[&*!]/;

function quotedTopLevelParams(text: string): boolean {
  if (/^'params'[ \t]*:/.test(text)) return true;
  const match = /^"((?:\\.|[^"])*)"[ \t]*:/.exec(text);
  if (!match) return false;
  const decoded = match[1]!
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\U([0-9a-f]{8})/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\(["\\/])/g, '$1');
  return decoded === 'params';
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let end = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n)/g)) {
    lines.push({ text: match[1] ?? '', eol: match[2] ?? '' });
    end = match.index + match[0].length;
  }
  if (end < text.length) lines.push({ text: text.slice(end), eol: '' });
  return lines;
}

function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === '\\') index += 1;
    else if (text[index] === quote) {
      if (quote === "'" && text[index + 1] === "'") index += 1;
      else return index + 1;
    }
  }
  return -1;
}

function scalarSpan(
  text: string,
  from: number,
): { start: number; end: number } | undefined {
  const start = from + /^[ \t]*/.exec(text.slice(from))![0].length;
  const first = text[start];
  if (first === undefined || /[|>&*!{}[\]%@`,?]/.test(first)) return undefined;
  if (first === '"' || first === "'") {
    const end = closingQuote(text, start);
    return end > 0 && /^[ \t]*(?:#.*)?$/.test(text.slice(end))
      ? { start, end }
      : undefined;
  }
  const comment = text.slice(start).search(/[ \t]#/);
  let end = comment < 0 ? text.length : start + comment;
  while (end > start && /[ \t]/.test(text[end - 1]!)) end -= 1;
  return end > start ? { start, end } : undefined;
}

function fieldsOf(body: readonly Line[]): ReadonlyMap<string, Field> | string {
  const fields = new Map<string, Field>();
  for (let index = 1; index < body.length; index += 1) {
    const line = body[index]!;
    if (FILLER.test(line.text)) continue;
    if (QUOTED_FIELD.test(line.text)) return QUOTED_REASON;
    const match = FIELD.exec(line.text);
    if (!match) return LAYOUT_REASON;
    const key = match[1]!;
    if (fields.has(key)) return DUPLICATE_REASON;
    const valueAt = line.text.indexOf(':') + 1;
    if (METADATA.test(line.text.slice(valueAt))) return METADATA_REASON;
    const span = scalarSpan(line.text, valueAt);
    if (!span) return LAYOUT_REASON;
    fields.set(key, { line: index, ...span });
  }
  return fields;
}

function itemsOf(
  block: readonly Line[],
): { items: ParamItem[]; rest: Line[] } | string {
  const starts: number[] = [];
  const names = new Set<string>();
  for (const [index, line] of block.entries()) {
    if (FILLER.test(line.text)) continue;
    if (QUOTED_PARAM.test(line.text)) return QUOTED_REASON;
    if (!/^  \S/.test(line.text)) continue;
    const match = PARAM_HEADER.exec(line.text);
    if (!match) return LAYOUT_REASON;
    if (names.has(match[1]!)) return DUPLICATE_REASON;
    names.add(match[1]!);
    starts.push(index);
  }
  const head = block.slice(0, starts[0] ?? block.length);
  if (!head.every((line) => FILLER.test(line.text))) return LAYOUT_REASON;
  let lead = starts.length > 0 ? [...head] : [];
  const items: ParamItem[] = [];
  for (const [position, start] of starts.entries()) {
    const match = PARAM_HEADER.exec(block[start]!.text)!;
    const rawTail = match[2] ?? '';
    if (METADATA.test(rawTail)) return METADATA_REASON;
    const emptyFlow = /^\{\}[ \t]*(?:#.*)?$/.test(rawTail);
    if (rawTail !== '' && !/^#/.test(rawTail) && !emptyFlow) {
      return rawTail.startsWith('{') ? FLOW_REASON : LAYOUT_REASON;
    }
    const chunk = block.slice(start, starts[position + 1] ?? block.length);
    let cut = chunk.length;
    while (cut > 1 && FILLER.test(chunk[cut - 1]!.text)) cut -= 1;
    const body = chunk.slice(0, cut);
    const fields = emptyFlow ? new Map<string, Field>() : fieldsOf(body);
    if (typeof fields === 'string') return fields;
    items.push({
      name: match[1]!,
      keyStart: 2,
      keyEnd: 2 + match[1]!.length,
      lead,
      body,
      fields,
      emptyFlow,
    });
    lead = chunk.slice(cut);
  }
  return { items, rest: lead };
}

function planFor(text: string): Plan | string | undefined {
  const lines = linesOf(text);
  if (lines.some((line) => quotedTopLevelParams(line.text))) {
    return QUOTED_REASON;
  }
  const candidates = lines.flatMap((line, index) =>
    ANY_PARAMS_KEY.test(line.text) ? [index] : [],
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) return DUPLICATE_REASON;
  const key = candidates[0]!;
  const keyText = lines[key]!.text;
  if (QUOTED_PARAMS_KEY.test(keyText)) return QUOTED_REASON;
  if (!PARAMS_KEY.test(keyText)) {
    const tail = keyText.slice(keyText.indexOf(':') + 1);
    if (METADATA.test(tail)) return METADATA_REASON;
    return tail.trimStart().startsWith('{') ? FLOW_REASON : LAYOUT_REASON;
  }
  const nextFound = lines.findIndex(
    (line, index) => index > key && TOP_LEVEL.test(line.text),
  );
  const next = nextFound < 0 ? lines.length : nextFound;
  const parsed = itemsOf(lines.slice(key + 1, next));
  if (typeof parsed === 'string') return parsed;
  return {
    lines,
    key,
    next,
    ...parsed,
    eol: lines[key]!.eol || lines.find((line) => line.eol)?.eol || '\n',
  };
}

function generated(param: ParamToWrite, eol: string): Line[] {
  const fields = [
    ...(param.description !== ''
      ? [`    description: ${scalar(param.description)}`]
      : []),
    ...(param.default !== '' ? [`    default: ${scalar(param.default)}`] : []),
    ...(param.required ? ['    required: true'] : []),
  ];
  return fields.length === 0
    ? [{ text: `  ${param.name}: {}`, eol }]
    : [
        { text: `  ${param.name}:`, eol },
        ...fields.map((text) => ({ text, eol })),
      ];
}

function appendLines(
  target: Line[],
  added: readonly Line[],
  eol: string,
): void {
  if (added.length === 0) return;
  const last = target.at(-1);
  if (last?.eol === '') target[target.length - 1] = { ...last, eol };
  target.push(...added);
}

function editItem(
  item: ParamItem,
  param: ParamToWrite,
  eol: string,
): Line[] | string {
  const before = param.before;
  if (!before) return LAYOUT_REASON;
  let lines = item.body.map((line) => ({ ...line }));
  if (before.name !== param.name) {
    const header = lines[0]!;
    lines[0] = {
      ...header,
      text: `${header.text.slice(0, item.keyStart)}${param.name}${header.text.slice(item.keyEnd)}`,
    };
  }
  const additions: Line[] = [];
  for (const key of ['description', 'default', 'required'] as const) {
    const beforeValue =
      key === 'required' ? (before.required ?? false) : (before[key] ?? '');
    const afterValue = key === 'required' ? param.required : param[key];
    if (beforeValue === afterValue) continue;
    const field = item.fields.get(key);
    const value =
      key === 'required' ? String(param.required) : scalar(param[key]);
    if (field) {
      const line = lines[field.line]!;
      lines[field.line] = {
        ...line,
        text: `${line.text.slice(0, field.start)}${value}${line.text.slice(field.end)}`,
      };
    } else if (key === 'required' ? param.required : param[key] !== '') {
      additions.push({ text: `    ${key}: ${value}`, eol });
    }
  }
  if (additions.length === 0) return lines;
  if (item.emptyFlow) {
    const header = lines[0]!;
    const token = header.text.indexOf('{}');
    lines = [
      {
        ...header,
        text: `${header.text.slice(0, token)}${header.text.slice(token + 2)}`,
      },
    ];
  }
  appendLines(lines, additions, eol);
  return lines;
}

/** The file-wide reason parameter declarations cannot be edited in place. */
export function paramsInPlaceBlocker(text: string): string | undefined {
  const plan = planFor(text);
  return typeof plan === 'string' ? plan : undefined;
}

/** Writes changed parameter ranges while preserving every other byte. */
export function withParams(
  text: string,
  params: readonly ParamToWrite[],
): Written {
  const plan = planFor(text);
  if (typeof plan === 'string') return { ok: false, reason: plan };
  if (!plan) {
    if (params.some((param) => param.from !== undefined)) {
      return { ok: false, reason: LAYOUT_REASON };
    }
    const lines = linesOf(text);
    const stages = lines.findIndex((line) => STAGES_KEY.test(line.text));
    if (stages < 0) return { ok: false, reason: LAYOUT_REASON };
    const eol = lines.find((line) => line.eol)?.eol || '\n';
    return {
      ok: true,
      text: [
        ...lines.slice(0, stages),
        { text: 'params:', eol },
        ...params.flatMap((param) => generated(param, eol)),
        ...lines.slice(stages),
      ]
        .map((line) => line.text + line.eol)
        .join(''),
    };
  }
  const claimed = new Set<number>();
  const body: Line[] = [];
  for (const param of params) {
    if (param.from === undefined) {
      appendLines(body, generated(param, plan.eol), plan.eol);
      continue;
    }
    const item = plan.items[param.from];
    if (!item || claimed.has(param.from)) {
      return { ok: false, reason: LAYOUT_REASON };
    }
    claimed.add(param.from);
    const edited = editItem(item, param, plan.eol);
    if (typeof edited === 'string') return { ok: false, reason: edited };
    appendLines(body, [...item.lead, ...edited], plan.eol);
  }
  const output = [
    ...plan.lines.slice(0, plan.key + 1),
    ...body,
    ...plan.rest,
    ...plan.lines.slice(plan.next),
  ];
  if (plan.next === plan.lines.length && plan.lines.at(-1)?.eol === '') {
    const last = output.at(-1);
    if (last) output[output.length - 1] = { ...last, eol: '' };
  }
  return {
    ok: true,
    text: output.map((line) => line.text + line.eol).join(''),
  };
}
