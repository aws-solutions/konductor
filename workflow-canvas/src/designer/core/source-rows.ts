// SPDX-License-Identifier: Apache-2.0
import { eolOf, type SourcePatch } from './yaml-source';

export interface SourceRowMatch {
  readonly current: number;
  readonly source: number;
}

export interface SourceRow {
  readonly start: number;
  readonly contentEnd: number;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface SourceRows {
  readonly flow: boolean;
  readonly close: number;
  readonly indent: string;
  readonly rows: readonly SourceRow[];
  readonly hasComments: boolean;
}

export function indexGroups(indices: readonly number[]): number[][] {
  const result: number[][] = [];
  for (const index of indices) {
    const group = result.at(-1);
    if (group?.at(-1) === index - 1) group.push(index);
    else result.push([index]);
  }
  return result;
}

export function sourceRowMatches(
  sourceCount: number,
  currentSources: readonly (number | undefined)[],
): readonly SourceRowMatch[] | undefined {
  const used = new Set<number>();
  const matches: SourceRowMatch[] = [];
  for (const [current, source] of currentSources.entries()) {
    if (
      source === undefined ||
      source < 0 ||
      source >= sourceCount ||
      used.has(source)
    ) {
      if (source !== undefined) return undefined;
      continue;
    }
    used.add(source);
    matches.push({ current, source });
  }
  return matches;
}

/** Adds and removes source-backed rows without rebuilding survivors. */
export function sourceRowPatches({
  text,
  source,
  matches,
  currentCount,
  render,
  commentReason,
  emptyText = '{}',
}: {
  text: string;
  source: SourceRows;
  matches: readonly SourceRowMatch[];
  currentCount: number;
  render: (current: number) => string;
  commentReason: string;
  emptyText?: string;
}): readonly SourcePatch[] | string {
  const structural =
    matches.length !== currentCount || matches.length !== source.rows.length;
  if (!structural) return [];
  if (source.hasComments) return commentReason;
  const patches: SourcePatch[] = [];
  const kept = new Set(matches.map(({ source }) => source));
  const removed = source.rows
    .map((_, index) => index)
    .filter((index) => !kept.has(index));
  if (removed.length > 0 && kept.size === 0) {
    patches.push({
      start: source.rows[0]!.start,
      end: source.rows.at(-1)!.contentEnd,
      text: source.flow ? '' : emptyText,
    });
  } else {
    for (const group of indexGroups(removed)) {
      const first = group[0]!;
      const last = group.at(-1)!;
      if (source.flow) {
        const next = source.rows[last + 1];
        patches.push(
          next
            ? { start: source.rows[first]!.start, end: next.start, text: '' }
            : {
                start: source.rows[first - 1]!.contentEnd,
                end: source.rows[last]!.contentEnd,
                text: '',
              },
        );
      } else {
        const lastRow = source.rows[last]!;
        const atEof = lastRow.lineEnd === text.length && !/[\r\n]$/.test(text);
        patches.push(
          atEof
            ? {
                start: source.rows[first - 1]!.contentEnd,
                end: lastRow.contentEnd,
                text: '',
              }
            : {
                start: source.rows[first]!.lineStart,
                end: lastRow.lineEnd,
                text: '',
              },
        );
      }
    }
  }
  const matched = new Set(matches.map(({ current }) => current));
  const added = Array.from(
    { length: currentCount },
    (_, index) => index,
  ).filter((index) => !matched.has(index));
  for (const group of indexGroups(added)) {
    const rows = group.map(render);
    const next = matches.find(({ current }) => current > group.at(-1)!);
    const previous = [...matches]
      .reverse()
      .find(({ current }) => current < group[0]!);
    if (next) {
      const row = source.rows[next.source]!;
      patches.push({
        start: source.flow ? row.start : row.lineStart,
        end: source.flow ? row.start : row.lineStart,
        text: source.flow
          ? `${rows.join(', ')}, `
          : rows
              .map((value) => `${source.indent}${value}${eolOf(text)}`)
              .join(''),
      });
    } else if (previous) {
      const row = source.rows[previous.source]!;
      patches.push({
        start: row.contentEnd,
        end: row.contentEnd,
        text: source.flow
          ? `, ${rows.join(', ')}`
          : `${eolOf(text)}${rows.map((value) => `${source.indent}${value}`).join(eolOf(text))}`,
      });
    } else {
      patches.push({
        start: source.close,
        end: source.close,
        text: rows.join(', '),
      });
    }
  }
  return patches;
}
