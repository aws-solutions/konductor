// SPDX-License-Identifier: Apache-2.0

import { isMap } from 'yaml';
import { ApiError } from './errors.ts';
import { entriesOf, parseDocuments } from './yaml-subset.ts';
import { checkWorkflowText } from './validator.ts';

const LIBRARY_NAME = /^library\/[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_ENTRIES = 100;
const MAX_TITLE = 120;
const MAX_DETAIL = 240;

interface LibraryRow {
  name: string;
  title: string;
  summary: string;
}

/** One workflow advertised by the shipped library. */
export type LibraryEntry = LibraryRow &
  ({ status: 'ready' } | { status: 'planned'; waits: string });

/** A shipped library row and its embedded source when ready. */
export type ShippedWorkflow = LibraryRow &
  (
    | { status: 'ready'; text: string; waits?: never }
    | { status: 'planned'; waits: string; text?: never }
  );

const REVIEW_TEXT = `format: konductor/1
version: 0.1.0
intent:
  outcome: Review a pull request for security, integrity, and schema risks
stages:
  - name: ingest
    agent: k-researcher
    prompt: Read the pull request diff and identify the changed contracts.
  - name: review-security
    agent: k-developer
    prompt: Review the changes for information disclosure and authorization gaps.
  - name: review-integrity
    agent: k-quality-assurance
    prompt: Review mutations for atomicity, ordering, and idempotency gaps.
  - name: consolidate
    agent: k-developer
    prompt: Validate the findings and write one prioritized review.
`;

/** The sample library advertised by the stub. */
export const SHIPPED_LIBRARY: readonly ShippedWorkflow[] = [
  {
    name: 'library/k-adversarial-pull-request-review',
    title: 'Adversarial pull request review',
    summary: 'Review a pull request for security, integrity, and schema risks.',
    status: 'ready',
    text: REVIEW_TEXT,
  },
  {
    name: 'library/k-design-doc-creation',
    title: 'Design document creation',
    summary: 'Turn requirements into a reviewed design document.',
    status: 'planned',
    waits: 'The workflow needs human gates.',
  },
];

function declaresName(text: string): boolean {
  const root = parseDocuments(text)[0]?.contents;
  return (
    isMap(root) && entriesOf(root).some((entry) => entry.keyText === 'name')
  );
}

function displayText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    [...value].length <= max &&
    !/[\r\n]/.test(value)
  );
}

function rowOf(value: unknown): ShippedWorkflow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const { name, title, summary, status } = row;
  if (
    typeof name !== 'string' ||
    !LIBRARY_NAME.test(name) ||
    !displayText(title, MAX_TITLE) ||
    !displayText(summary, MAX_DETAIL)
  ) {
    return undefined;
  }
  if (
    status === 'ready' &&
    typeof row['text'] === 'string' &&
    !Object.hasOwn(row, 'waits')
  ) {
    return { name, title, summary, status, text: row['text'] };
  }
  if (
    status === 'planned' &&
    displayText(row['waits'], MAX_DETAIL) &&
    !Object.hasOwn(row, 'text')
  ) {
    return { name, title, summary, status, waits: row['waits'] };
  }
  return undefined;
}

function invalidReady(entry: ShippedWorkflow): boolean {
  if (entry.status !== 'ready') return false;
  if (declaresName(entry.text)) return true;
  const name = entry.name.slice('library/'.length);
  return checkWorkflowText(entry.text, name).view === null;
}

/** The library rows in their display order, without workflow text. */
export function listLibrary(
  entries: readonly unknown[] = SHIPPED_LIBRARY,
): LibraryEntry[] {
  const rows = entries.flatMap((entry) => {
    const row = rowOf(entry);
    return row ? [row] : [];
  });
  const names = new Set(rows.map((entry) => entry.name));
  if (
    entries.length > MAX_ENTRIES ||
    rows.length !== entries.length ||
    names.size !== rows.length ||
    rows.some(invalidReady)
  ) {
    throw new ApiError(
      'io_error',
      'The server could not read or write its files.',
    );
  }
  return rows.map((entry): LibraryEntry =>
    entry.status === 'ready'
      ? {
          name: entry.name,
          title: entry.title,
          summary: entry.summary,
          status: entry.status,
        }
      : {
          name: entry.name,
          title: entry.title,
          summary: entry.summary,
          status: entry.status,
          waits: entry.waits,
        },
  );
}

/** Finds one shipped workflow, including its text when it is ready. */
export function findLibrary(
  name: string,
  entries: readonly ShippedWorkflow[] = SHIPPED_LIBRARY,
): ShippedWorkflow | undefined {
  return entries.find((entry) => entry.name === name);
}
