// SPDX-License-Identifier: Apache-2.0
import type { CheckAnswer, CheckDiagnostic } from '../designer-view/yaml-draft';

/** How many findings of the check are shown at once. */
export const FINDINGS_PER_PAGE = 20;

/** The most findings the list ever shows, however many the server sends. */
export const FINDINGS_SHOWN_MOST = 200;

const ORDER: readonly string[] = ['error', 'warning', 'info'];

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
  const sorted = [...all]
    .slice(0, FINDINGS_SHOWN_MOST)
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
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
