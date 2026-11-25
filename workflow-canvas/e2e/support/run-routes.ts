// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';

const RUN_ID = '20261024-0412-a7b3c';

/** Makes the page's call to start a run fail with the status and body. */
export async function refuseRunsWith(
  page: Page,
  status: number,
  body: { error: string; code: string; fix?: string },
): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({ status, json: body }),
  );
}

/** One event of a run, as `GET /api/runs/{id}/events` sends it. */
export type RunEventBody = Record<string, unknown> & { seq: number };

/** The `stage_state` event of a stage that passed. */
export const passed = (seq: number, stage: string): RunEventBody => ({
  seq,
  type: 'stage_state',
  stage,
  status: 'passed',
});

/** The `stage_state` event of a stage that is at work. */
export const running = (seq: number, stage: string): RunEventBody => ({
  seq,
  type: 'stage_state',
  stage,
  status: 'running',
});

/** The `stage_state` event of a stage that stopped the run. */
export const blocked = (
  seq: number,
  stage: string,
  reason: string,
): RunEventBody => ({
  seq,
  type: 'stage_state',
  stage,
  status: 'blocked',
  reason,
});

/** The `run_finished` event of a run that ended with the status. */
export const runFinished = (
  seq: number,
  status: 'passed' | 'halted',
): RunEventBody => ({
  seq,
  type: 'run_finished',
  at: '2026-10-24T04:12:49Z',
  status,
  exit_code: status === 'passed' ? 0 : 1,
});

/** The `run_finished` event of a run that passed. */
export const runPassed = (seq: number): RunEventBody =>
  runFinished(seq, 'passed');

/** One row of `GET /api/runs`. */
export function runRow(status: 'running' | 'passed' | 'halted' = 'passed') {
  return {
    run_id: RUN_ID,
    started_at: '2026-10-24T04:12:05Z',
    status,
    goal: 'Add a greeting to the README',
    goal_truncated: false,
  };
}

/**
 * Answers the calls of a run with fixed replies: the start is accepted, the
 * events come in one page, the past runs are the rows given and the run's
 * check states are the map given. The stub
 * runs one run at a time, so this leaves it for the tests that run on it,
 * and a run here never waits the three seconds a stage takes there.
 */
export async function answerRunWith(
  page: Page,
  events: readonly RunEventBody[],
  runs: readonly ReturnType<typeof runRow>[] = [runRow()],
  {
    finished = true,
    checks = {},
  }: {
    readonly finished?: boolean;
    readonly checks?: Readonly<Record<string, string>>;
  } = {},
): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({ status: 202, json: { run_id: RUN_ID } }),
  );
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs } }));
  await page.route('**/api/runs/*', (route) =>
    route.fulfill({ json: { run: { checks } } }),
  );
  // Registered last, so it wins over the list route above for this path.
  await page.route('**/api/runs/*/events*', (route) =>
    route.fulfill({
      json: { events, next: events.at(-1)?.seq ?? 0, finished },
    }),
  );
}
