// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { CheckAnswer, CheckDiagnostic } from '../designer-view/yaml-draft';
import {
  FINDINGS_PER_PAGE,
  FINDINGS_SHOWN_MOST,
  findingsPage,
  mergeFindings,
  nextShown,
} from './findings';

const finding = (
  line: number,
  severity: CheckDiagnostic['severity'] = 'error',
): CheckDiagnostic => ({
  code: 'UNKNOWN_KEY',
  severity,
  path: `stages[${line}]`,
  line,
  column: 1,
  end_line: line,
  end_column: 2,
  message: `Problem ${line}.`,
});

const answerOf = (diagnostics: readonly CheckDiagnostic[]): CheckAnswer => ({
  errors: diagnostics.filter((one) => one.severity === 'error').length,
  warnings: diagnostics.filter((one) => one.severity === 'warning').length,
  infos: diagnostics.filter((one) => one.severity === 'info').length,
  view: null,
  diagnostics,
});

const many = (count: number) =>
  answerOf(Array.from({ length: count }, (_, index) => finding(index + 1)));

describe('findingsPage', () => {
  it('shows nothing before a check has answered', () => {
    expect(findingsPage(undefined, FINDINGS_PER_PAGE)).toEqual({
      page: [],
      left: 0,
      more: 0,
    });
  });

  it('shows every finding of a short list, with nothing left', () => {
    const page = findingsPage(many(3), FINDINGS_PER_PAGE);

    expect(page.page).toHaveLength(3);
    expect(page.left).toBe(0);
    expect(page.more).toBe(0);
  });

  it('shows a page of a long list and says how many are left', () => {
    const page = findingsPage(many(500), FINDINGS_PER_PAGE);

    expect(page.page).toHaveLength(FINDINGS_PER_PAGE);
    expect(page.left).toBe(480);
    expect(page.more).toBe(FINDINGS_PER_PAGE);
  });

  it('shows the worst findings first', () => {
    const answer = answerOf([
      finding(1, 'info'),
      finding(2, 'warning'),
      finding(3, 'error'),
    ]);

    expect(findingsPage(answer, 3).page.map((one) => one.severity)).toEqual([
      'error',
      'warning',
      'info',
    ]);
  });

  it('shows an error the server sent after more findings than it lists', () => {
    // The cap must be taken after the ranking: the error is entry 1,001.
    const infos = Array.from({ length: 1_000 }, (_, index) =>
      finding(index + 1, 'info'),
    );
    const answer = answerOf([...infos, finding(1_001, 'error')]);

    const { page, left } = findingsPage(answer, FINDINGS_PER_PAGE);

    expect(page[0]?.line).toBe(1_001);
    expect(page[0]?.severity).toBe('error');
    expect(left).toBe(1_001 - FINDINGS_PER_PAGE);
  });

  it('keeps the order the server sent within one severity', () => {
    const answer = answerOf([
      finding(7, 'warning'),
      finding(3, 'error'),
      finding(5, 'warning'),
      finding(1, 'error'),
    ]);

    expect(findingsPage(answer, 4).page.map((one) => one.line)).toEqual([
      3, 1, 7, 5,
    ]);
  });

  it('never shows more than its own limit', () => {
    const page = findingsPage(many(5_000), 5_000);

    expect(page.page).toHaveLength(FINDINGS_SHOWN_MOST);
    expect(page.left).toBe(5_000 - FINDINGS_SHOWN_MOST);
    expect(page.more).toBe(0);
  });

  it('offers only the findings it may still show at the limit', () => {
    const page = findingsPage(many(5_000), FINDINGS_SHOWN_MOST - 5);

    expect(page.more).toBe(5);
  });

  it('shows nothing for a page of none', () => {
    expect(findingsPage(many(10), 0).page).toEqual([]);
  });
});

describe('mergeFindings', () => {
  it('keeps each finding once across answers', () => {
    const shared = finding(3);
    const saveOnly = finding(7);

    expect(mergeFindings([shared], [shared, saveOnly])).toEqual([
      shared,
      saveOnly,
    ]);
  });
});

describe('nextShown', () => {
  it('adds a page', () => {
    expect(nextShown(FINDINGS_PER_PAGE)).toBe(FINDINGS_PER_PAGE * 2);
  });

  it('stops at the limit', () => {
    expect(nextShown(FINDINGS_SHOWN_MOST - 1)).toBe(FINDINGS_SHOWN_MOST);
    expect(nextShown(FINDINGS_SHOWN_MOST)).toBe(FINDINGS_SHOWN_MOST);
  });
});
