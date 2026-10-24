// SPDX-License-Identifier: Apache-2.0

const MAX_DISTANCE = 2;

/** The edit distance between two texts, counting code points. */
export function editDistance(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let previous = right.map((_, index) => index + 1);
  previous.unshift(0);
  left.forEach((char, i) => {
    const row = [i + 1];
    right.forEach((other, j) => {
      const substitution = (previous[j] ?? 0) + (char === other ? 0 : 1);
      const deletion = (previous[j + 1] ?? 0) + 1;
      const insertion = (row[j] ?? 0) + 1;
      row.push(Math.min(substitution, deletion, insertion));
    });
    previous = row;
  });
  return previous[right.length] ?? 0;
}

/**
 * The candidate nearest to the key, the first one if two tie, or `undefined`
 * when none is within an edit distance of 2.
 */
export function suggestKey(
  key: string,
  candidates: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = MAX_DISTANCE + 1;
  for (const candidate of candidates) {
    const distance = editDistance(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
