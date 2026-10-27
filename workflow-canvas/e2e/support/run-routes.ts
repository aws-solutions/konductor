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

type RunReply = ReturnType<typeof runReply>;

async function acceptRuns(page: Page): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({ status: 202, json: { run_id: RUN_ID } }),
  );
}

/**
 * Makes the page's calls to start a run and to read it answer with `reply`,
 * without a run on the server. For states the stub never reaches, such as a
 * failed stage, and so that the stub, which runs one run at a time, is left
 * for the tests that run on it.
 */
export async function answerRunsWith(
  page: Page,
  reply: RunReply,
): Promise<void> {
  await acceptRuns(page);
  await page.route('**/api/runs/*', (route) => route.fulfill({ json: reply }));
}

/**
 * Like `answerRunsWith`, but each read of the run gets the next reply, and
 * the last one is repeated. `reads()` says how many reads the page has made,
 * so a test can wait for one without a fixed pause.
 */
export async function answerRunsInTurn(
  page: Page,
  replies: readonly RunReply[],
): Promise<{ reads(): number }> {
  await acceptRuns(page);
  let reads = 0;
  await page.route('**/api/runs/*', (route) => {
    const reply = replies[Math.min(reads, replies.length - 1)];
    reads += 1;
    return route.fulfill({ json: reply });
  });
  return { reads: () => reads };
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

/**
 * Makes the page's call to start a run answer 409 `already_running` with the
 * id of a run, and its reads answer with `reply`, as a server does while a
 * run from an earlier page load is still going.
 */
export async function joinActiveRunWith(
  page: Page,
  reply: ReturnType<typeof runReply>,
): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: 'A run is already active.',
        code: 'already_running',
        run_id: RUN_ID,
      },
    }),
  );
  await page.route('**/api/runs/*', (route) => route.fulfill({ json: reply }));
}

/**
 * Makes the first read of a run fail as if the connection dropped, then
 * answers every read with `reply`.
 */
export async function dropFirstReadThenAnswerWith(
  page: Page,
  reply: ReturnType<typeof runReply>,
): Promise<void> {
  let reads = 0;
  await page.route('**/api/runs/*', (route) => {
    reads += 1;
    return reads === 1 ? route.abort() : route.fulfill({ json: reply });
  });
}
