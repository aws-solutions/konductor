// SPDX-License-Identifier: Apache-2.0
import type { CheckAnswer, CheckDiagnostic } from '../designer-view/yaml-draft';

/** How many findings of the check are shown at once. */
export const FINDINGS_PER_PAGE = 20;

/** The most findings the list ever shows, however many the server sends. */
export const FINDINGS_SHOWN_MOST = 200;

const ORDER: readonly string[] = ['error', 'warning', 'info'];

// Where a finding ranks: by its severity, worst first. A severity this page
// does not know ranks after the ones it does, so it never pushes an error off
// the list.
function rankOf(finding: CheckDiagnostic): number {
  const rank = ORDER.indexOf(finding.severity);
  return rank < 0 ? ORDER.length : rank;
}

/**
 * The findings of an answer, worst first, at most `FINDINGS_SHOWN_MOST` of
 * them. The whole answer is ranked before it is cut, so an error the server
 * sent after a thousand infos is on the first page and no error is dropped
 * behind a finding of a lower severity. `Array#sort` is stable, so findings
 * of the same severity keep the order the server sent them in.
 */
function worstFirst(
  all: readonly CheckDiagnostic[],
): readonly CheckDiagnostic[] {
  return [...all]
    .sort((a, b) => rankOf(a) - rankOf(b))
    .slice(0, FINDINGS_SHOWN_MOST);
}

/** The page of findings to draw, and what is left over. */
export interface FindingsPage {
  /** The findings to list now, worst first. */
  readonly page: readonly CheckDiagnostic[];
  /** How many the server sent that this page does not list. */
  readonly left: number;
  /** How many more the next page would add, or 0 when there is no next page. */
  readonly more: number;
}

/**
 * The findings to show for an answer: the worst first, at most `shown` of
 * them, and never more than `FINDINGS_SHOWN_MOST` whatever the server sends,
 * because a text of a quarter of a megabyte can be wrong in thousands of
 * places and the browser would stall drawing them all. `left` says how many
 * are not listed and `more` how many the next page would add, so the caller
 * can offer it and stop offering it at the limit.
 */
export function findingsPage(
  answer: CheckAnswer | undefined,
  shown: number,
): FindingsPage {
  const all = answer?.diagnostics ?? [];
  const sorted = worstFirst(all);
  const page = sorted.slice(
    0,
    Math.max(0, Math.min(shown, FINDINGS_SHOWN_MOST)),
  );
  const room = FINDINGS_SHOWN_MOST - page.length;
  return {
    page,
    left: all.length - page.length,
    more: Math.min(FINDINGS_PER_PAGE, room, sorted.length - page.length),
  };
}

/** How many findings to show after the person asks for the next page. */
export function nextShown(shown: number): number {
  return Math.min(shown + FINDINGS_PER_PAGE, FINDINGS_SHOWN_MOST);
}
