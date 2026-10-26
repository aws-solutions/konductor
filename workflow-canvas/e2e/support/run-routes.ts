// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';

const RUN_ID = '20261024-0412-a7b3c';

/** The stages of the sample workflow, in order, and what a run says of them. */
export type StageStatuses = readonly [
  'pending' | 'running' | 'passed' | 'blocked',
  'pending' | 'running' | 'passed' | 'blocked',
];

/** A reply of `GET /api/runs/{id}` for the sample workflow. */
export function runReply(
  status: 'running' | 'passed' | 'halted',
  [draft, review]: StageStatuses,
) {
  const finished = status !== 'running';
  return {
    run: {
      run_id: RUN_ID,
      workflow: 'hello',
      harness: 'kiro-cli',
      status,
      started_at: '2026-10-24T04:12:05Z',
      finished_at: finished ? '2026-10-24T04:12:49Z' : null,
      exit_code: finished ? (status === 'passed' ? 0 : 1) : null,
      order: ['draft', 'review'],
      stages: { draft: { status: draft }, review: { status: review } },
    },
  };
}

/**
 * Makes the page's calls to start a run and to read it answer with `reply`,
 * without a run on the server. For states the stub never reaches, such as a
 * failed stage, and so that the stub, which runs one run at a time, is left
 * for the tests that run on it.
 */
export async function answerRunsWith(
  page: Page,
  reply: ReturnType<typeof runReply>,
): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({ status: 202, json: { run_id: RUN_ID } }),
  );
  await page.route('**/api/runs/*', (route) => route.fulfill({ json: reply }));
}

/** Makes the page's call to start a run fail with the status and body. */
export async function refuseRunsWith(
  page: Page,
  status: number,
  body: { error: string; code: string },
): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({ status, json: body }),
  );
}
