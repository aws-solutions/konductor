// SPDX-License-Identifier: Apache-2.0

import { isMap } from 'yaml';
import { ApiError } from './errors.ts';
import { entriesOf, parseDocuments } from './yaml-subset.ts';

/** One workflow advertised by the shipped library. */
export interface LibraryEntry {
  name: string;
  title: string;
  summary: string;
  status: 'ready' | 'planned';
  waits?: string;
}

/** A shipped library row and its embedded source when ready. */
export interface ShippedWorkflow extends LibraryEntry {
  text?: string;
}

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

/** The library rows in their display order, without workflow text. */
export function listLibrary(
  entries: readonly ShippedWorkflow[] = SHIPPED_LIBRARY,
): LibraryEntry[] {
  if (
    entries.some(
      (entry) =>
        entry.status === 'ready' &&
        (entry.text === undefined || declaresName(entry.text)),
    )
  ) {
    throw new ApiError(
      'io_error',
      'The server could not read or write its files.',
    );
  }
  return entries.map(({ name, title, summary, status, waits }) => ({
    name,
    title,
    summary,
    status,
    ...(waits === undefined ? {} : { waits }),
  }));
}

/** Finds one shipped workflow, including its text when it is ready. */
export function findLibrary(
  name: string,
  entries: readonly ShippedWorkflow[] = SHIPPED_LIBRARY,
): ShippedWorkflow | undefined {
  return entries.find((entry) => entry.name === name);
}
