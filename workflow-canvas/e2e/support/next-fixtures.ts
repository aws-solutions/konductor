// SPDX-License-Identifier: Apache-2.0
import { test as base, type Page } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { sharedSession } from './session';
import { WorkflowCanvasPage } from './workflow-canvas-page';

export { expect } from '@playwright/test';

/** The query that asks the page for the views being built. */
export const NEXT_UI_QUERY = 'ui=next';

const RUN_ID = '20261024-0412-a7b3c';

/**
 * `test` with a `next` page object that has opened the app with `?ui=next`,
 * so the page draws the views being built.
 *
 * A launch code works once, and the global setup has used it, so the page's
 * own `POST /api/session` is answered with that session. Every other call
 * goes to the API for real, with the token of that session.
 */
export const test = base.extend<{ next: WorkflowCanvasPage }>({
  next: async ({ page }, use) => {
    await page.route('**/api/session', (route) =>
      route.fulfill({ json: sharedSession() }),
    );
    const canvas = new WorkflowCanvasPage(page);
    await page.goto(`/?${NEXT_UI_QUERY}#${STUB_LAUNCH_CODE}`);
    await canvas.title.waitFor();
    await use(canvas);
  },
});

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

/** The `run_finished` event of a run that passed. */
export const runPassed = (seq: number): RunEventBody => ({
  seq,
  type: 'run_finished',
  at: '2026-10-24T04:12:49Z',
  status: 'passed',
  exit_code: 0,
});

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
 * events come in one page, and the past runs are the rows given. The stub
 * runs one run at a time, so this leaves it for the tests that run on it,
 * and a run here never waits the three seconds a stage takes there.
 */
export async function answerRunWith(
  page: Page,
  events: readonly RunEventBody[],
  runs: readonly ReturnType<typeof runRow>[] = [runRow()],
  { finished = true }: { readonly finished?: boolean } = {},
): Promise<void> {
  await page.route('**/api/run', (route) =>
    route.fulfill({ status: 202, json: { run_id: RUN_ID } }),
  );
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs } }));
  // Registered last, so it wins over the list route above for this path.
  await page.route('**/api/runs/*/events*', (route) =>
    route.fulfill({
      json: { events, next: events.at(-1)?.seq ?? 0, finished },
    }),
  );
}
