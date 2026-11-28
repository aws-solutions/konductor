// SPDX-License-Identifier: Apache-2.0
import { scalar } from './scalar-text';
import {
  scalarSequencePatches,
  scalarSequenceSource,
  type ScalarSequenceSource,
} from './source-sequence';
import {
  sourceRowMatches,
  sourceRowPatches,
  type SourceRow,
  type SourceRowMatch,
  type SourceRows,
} from './source-rows';
import type { Written } from './stage-text';
import {
  afterLine,
  applyPatches,
  columnOf,
  contentEnd,
  eolOf,
  hasComment,
  hasMapComments,
  insertMapPair,
  isMap,
  isSeq,
  lineStart,
  parseDocument,
  textScalar,
  uniquePair,
  type SourcePatch,
  type TextScalar,
  type YAMLMap,
} from './yaml-source';

export interface CheckToWrite {
  readonly id: string;
  readonly kind: 'file' | 'run';
  readonly file: string;
  readonly run: readonly string[];
  readonly source?: number;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const CHECK_ID_ERROR =
  'A check id must start with a lowercase letter or digit and contain only lowercase letters, digits or hyphens, up to 64 characters.';
export const CHECK_DUPLICATE_ERROR = 'Check ids must be unique.';
export const CHECK_RUN_ERROR = 'A run check needs at least one argument.';
export const CHECK_ORDER_ERROR = 'Acceptance checks cannot be reordered here.';
export const CHECK_COMMENTS_REASON =
  'This check collection contains comments, so rows cannot be added or removed here. Change the rows in the YAML tab.';

export const checkIdError = (id: string): string | undefined =>
  NAME.test(id) ? undefined : CHECK_ID_ERROR;

const LAYOUT =
  'The checks use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';
const METADATA =
  'The checks use an anchor, alias or tag, so the editor cannot change them safely. Change them in the YAML tab.';
const DUPLICATE_SOURCE =
  'The checks contain a duplicate key, so the editor cannot change them safely. Change them in the YAML tab.';

interface CheckSpot extends SourceRow {
  readonly id: TextScalar;
  readonly kind: 'file' | 'run';
  readonly value: TextScalar | ScalarSequenceSource;
  readonly flow: boolean;
  readonly fieldStart: number;
  readonly fieldEnd: number;
  readonly fieldIndent: string;
  readonly hasComments: boolean;
}

interface AcceptanceSource extends SourceRows {
  readonly rows: readonly CheckSpot[];
}

interface AcceptanceSpot {
  readonly map: YAMLMap;
  readonly source?: AcceptanceSource;
  readonly reason?: string;
}

function checkSpot(
  text: string,
  value: unknown,
  flowSequence: boolean,
): CheckSpot | string {
  if (!isMap(value) || !value.range || value.anchor || value.tag) {
    return METADATA;
  }
  const idPair = uniquePair(value, 'id');
  const filePair = uniquePair(value, 'file');
  const runPair = uniquePair(value, 'run');
  if ([idPair, filePair, runPair].includes('duplicate')) {
    return DUPLICATE_SOURCE;
  }
  if (!idPair || idPair === 'duplicate') return LAYOUT;
  const fields = [filePair, runPair].filter(
    (pair) => pair !== undefined && pair !== 'duplicate',
  );
  if (fields.length !== 1) return LAYOUT;
  const id = textScalar(idPair.value);
  const kind = filePair && filePair !== 'duplicate' ? 'file' : 'run';
  const pair = fields[0]!;
  const key = textScalar(pair.key);
  const field =
    kind === 'file'
      ? textScalar(pair.value)
      : scalarSequenceSource(text, pair.value);
  if (!id || !key || !field) return METADATA;
  const rowEnd = flowSequence ? value.range[1] : contentEnd(value);
  return {
    id,
    kind,
    value: field,
    flow: value.flow === true,
    start: flowSequence ? value.range[0] : lineStart(text, value.range[0]),
    contentEnd: rowEnd,
    lineStart: lineStart(text, value.range[0]),
    lineEnd: flowSequence ? value.range[1] : afterLine(text, rowEnd),
    fieldStart: value.flow ? key.range[0] : lineStart(text, key.range[0]),
    fieldEnd: contentEnd(pair.value),
    fieldIndent: ' '.repeat(columnOf(text, key.range[0])),
    hasComments:
      hasComment(value) ||
      value.items.some(
        (item) =>
          hasComment(item) || hasComment(item.key) || hasComment(item.value),
      ),
  };
}

function acceptanceSpot(text: string): AcceptanceSpot | string {
  const document = parseDocument(text, { uniqueKeys: false });
  if (document.errors.length > 0 || !isMap(document.contents)) return LAYOUT;
  const intentPair = uniquePair(document.contents, 'intent');
  if (intentPair === 'duplicate') return DUPLICATE_SOURCE;
  if (!intentPair || !isMap(intentPair.value)) return LAYOUT;
  const acceptPair = uniquePair(intentPair.value, 'accept');
  if (acceptPair === 'duplicate') {
    return { map: intentPair.value, reason: DUPLICATE_SOURCE };
  }
  if (!acceptPair) return { map: intentPair.value };
  if (
    !isSeq(acceptPair.value) ||
    !acceptPair.value.range ||
    acceptPair.value.anchor ||
    acceptPair.value.tag
  ) {
    return { map: intentPair.value, reason: METADATA };
  }
  const rows: CheckSpot[] = [];
  for (const item of acceptPair.value.items) {
    const row = checkSpot(text, item, acceptPair.value.flow === true);
    if (typeof row === 'string') return { map: intentPair.value, reason: row };
    rows.push(row);
  }
  return {
    map: intentPair.value,
    source: {
      flow: acceptPair.value.flow === true,
      close: acceptPair.value.range[1] - 1,
      indent: ' '.repeat(columnOf(text, acceptPair.value.range[0])),
      rows,
      hasComments:
        hasComment(acceptPair.key) ||
        hasComment(acceptPair.value) ||
        rows.some(({ hasComments }) => hasComments),
    },
  };
}

function renderCheck(
  check: CheckToWrite,
  flow: boolean,
  indent: string,
  eol: string,
): string {
  const value =
    check.kind === 'file'
      ? `file: ${scalar(check.file)}`
      : `run: [${check.run.map(scalar).join(', ')}]`;
  return flow
    ? `{id: ${scalar(check.id)}, ${value}}`
    : `- id: ${scalar(check.id)}${eol}${indent}  ${value}`;
}

function checkFieldPatches(
  text: string,
  check: CheckToWrite,
  spot: CheckSpot,
): readonly SourcePatch[] | string {
  const patches: SourcePatch[] = [];
  if (check.id !== spot.id.text) {
    patches.push({
      start: spot.id.range[0],
      end: spot.id.range[1],
      text: scalar(check.id),
    });
  }
  if (check.kind !== spot.kind) {
    const value =
      check.kind === 'file'
        ? scalar(check.file)
        : `[${check.run.map(scalar).join(', ')}]`;
    patches.push({
      start: spot.fieldStart,
      end: spot.fieldEnd,
      text: spot.flow
        ? `${check.kind}: ${value}`
        : `${spot.fieldIndent}${check.kind}: ${value}`,
    });
    return patches;
  }
  if (check.kind === 'file') {
    const value = spot.value as TextScalar;
    if (check.file !== value.text) {
      patches.push({
        start: value.range[0],
        end: value.range[1],
        text: scalar(check.file),
      });
    }
    return patches;
  }
  const changed = scalarSequencePatches(
    text,
    spot.value as ScalarSequenceSource,
    check.run,
  );
  return changed.structuralComment
    ? CHECK_COMMENTS_REASON
    : [...patches, ...(changed.patches ?? [])];
}

function rowOrderChanged(matches: readonly SourceRowMatch[]): boolean {
  return matches.some(
    ({ source }, index) => index > 0 && source < matches[index - 1]!.source,
  );
}

function existingPatches(
  text: string,
  source: AcceptanceSource,
  checks: readonly CheckToWrite[],
): readonly SourcePatch[] | string {
  const matches = sourceRowMatches(
    source.rows.length,
    checks.map(({ source }) => source),
  );
  if (!matches) return LAYOUT;
  if (rowOrderChanged(matches)) return CHECK_ORDER_ERROR;
  const structural = sourceRowPatches({
    text,
    source,
    matches,
    currentCount: checks.length,
    render: (current) =>
      renderCheck(
        checks[current]!,
        source.flow,
        source.flow ? '' : source.indent,
        eolOf(text),
      ),
    commentReason: CHECK_COMMENTS_REASON,
    emptyText: `${source.indent}[]`,
  });
  if (typeof structural === 'string') return structural;
  const patches: SourcePatch[] = [...structural];
  for (const { current, source: sourceIndex } of matches) {
    const changed = checkFieldPatches(
      text,
      checks[current]!,
      source.rows[sourceIndex]!,
    );
    if (typeof changed === 'string') return changed;
    patches.push(...changed);
  }
  return patches;
}

function insertedPatch(
  text: string,
  spot: AcceptanceSpot,
  checks: readonly CheckToWrite[],
): SourcePatch | string | undefined {
  if (checks.length === 0) return undefined;
  if (spot.map.flow && hasMapComments(spot.map)) {
    return CHECK_COMMENTS_REASON;
  }
  const first = textScalar(spot.map.items[0]?.key);
  if (!first) return LAYOUT;
  const eol = eolOf(text);
  const indent = ' '.repeat(columnOf(text, first.range[0]));
  const value = spot.map.flow
    ? `[${checks.map((check) => renderCheck(check, true, '', eol)).join(', ')}]`
    : `${eol}${checks
        .map(
          (check) =>
            `${indent}  ${renderCheck(check, false, `${indent}  `, eol)}`,
        )
        .join(eol)}`;
  return insertMapPair(text, spot.map, 'accept', value) ?? LAYOUT;
}

export function checkCollectionBlocker(
  text: string,
  collection: 'accept',
  structural = false,
): string | undefined {
  if (collection !== 'accept') return LAYOUT;
  const spot = acceptanceSpot(text);
  if (typeof spot === 'string') return spot;
  const insertionComments =
    !spot.source && spot.map.flow && hasMapComments(spot.map);
  return (
    spot.reason ??
    (structural && (spot.source?.hasComments || insertionComments)
      ? CHECK_COMMENTS_REASON
      : undefined)
  );
}

export function withAcceptanceChecks(
  text: string,
  checks: readonly CheckToWrite[],
): Written {
  if (checks.some(({ id }) => checkIdError(id))) {
    return { ok: false, reason: CHECK_ID_ERROR };
  }
  if (new Set(checks.map(({ id }) => id)).size !== checks.length) {
    return { ok: false, reason: CHECK_DUPLICATE_ERROR };
  }
  if (checks.some((check) => check.kind === 'run' && check.run.length === 0)) {
    return { ok: false, reason: CHECK_RUN_ERROR };
  }
  const spot = acceptanceSpot(text);
  if (typeof spot === 'string' || spot.reason) {
    return {
      ok: false,
      reason: typeof spot === 'string' ? spot : spot.reason!,
    };
  }
  const changed = spot.source
    ? existingPatches(text, spot.source, checks)
    : insertedPatch(text, spot, checks);
  if (typeof changed === 'string') return { ok: false, reason: changed };
  const patches =
    changed === undefined ? [] : Array.isArray(changed) ? changed : [changed];
  return { ok: true, text: applyPatches(text, patches) };
}
