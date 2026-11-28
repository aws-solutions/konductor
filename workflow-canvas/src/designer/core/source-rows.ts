// SPDX-License-Identifier: Apache-2.0

/** A current row matched to its stable source row. */
export interface SourceRowMatch {
  readonly current: number;
  readonly source: number;
}

/** Contiguous groups from sorted source indices. */
export function indexGroups(indices: readonly number[]): number[][] {
  const result: number[][] = [];
  for (const index of indices) {
    const group = result.at(-1);
    if (group?.at(-1) === index - 1) group.push(index);
    else result.push([index]);
  }
  return result;
}

/**
 * Matches rows by stable source identity. Rows without a source are additions;
 * unmatched source rows are removals. Current order is never inferred as a
 * rename, so remove-plus-add and reorder stay structural operations.
 */
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
