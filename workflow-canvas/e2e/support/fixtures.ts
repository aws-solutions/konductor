// SPDX-License-Identifier: Apache-2.0
import { test as base, type Page } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { sharedSession } from './session';
import { WorkflowCanvasPage } from './workflow-canvas-page';

export { expect } from '@playwright/test';

/**
 * `test` extended with a `canvas` page object that has already opened the
 * app with the launch code of the config.
 *
 * A launch code works once, and the global setup has used it. So the page's
 * own `POST /api/session` is answered with that session; every other call
 * goes to the API for real.
 */
export const test = base.extend<{ canvas: WorkflowCanvasPage }>({
  canvas: async ({ page }, use) => {
    await page.route('**/api/session', (route) =>
      route.fulfill({ json: sharedSession() }),
    );
    const canvas = new WorkflowCanvasPage(page);
    await canvas.open(STUB_LAUNCH_CODE);
    await use(canvas);
  },
});

/** The params a test has the workflow declare beside the goal. */
export const DECLARED_PARAMS = {
  diff_input: {
    type: 'string',
    description: 'The diff to read.',
    required: true,
  },
  // Required and with a default, so the test that clears it goes through the
  // shape it is named for: a value the run leaves out and the server fills in.
  branch: { type: 'string', default: 'main', required: true },
};

/*
 * The stub serves one workflow for the whole run, and the sample declares
 * only the goal, so a test that needs declared params adds them to the
 * answer of `GET /api/workflow` on its way to the page. Everything else is
 * the stub's: the text, the stages and its own answer to a start.
 */
async function declareParams(page: Page): Promise<void> {
  await page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const reply = await route.fetch();
    const body = (await reply.json()) as {
      view: { params?: Record<string, unknown> };
    };
    await route.fulfill({
      json: {
        ...body,
        view: {
          ...body.view,
          params: { ...body.view.params, ...DECLARED_PARAMS },
        },
      },
    });
  });
}

/** The checks a test has the workflow declare, with a stage waiting for one. */
export const DECLARED_CHECKS = [
  { id: 'readme-exists', file: 'README.md' },
  { id: 'tests-pass', run: ['make', 'test'] },
];

/**
 * Opens the page on the Run view with those checks declared. The stage
 * `draft` waits for `readme-exists`. A test gives the states of a run with
 * `answerRunWith`, so it sees a verified and a deferred check without waiting
 * for a server to run one.
 */
export async function openDeclaringChecks(
  page: Page,
): Promise<WorkflowCanvasPage> {
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const reply = await route.fetch();
    const body = (await reply.json()) as {
      view: { intent: Record<string, unknown>; stages: unknown[] };
    };
    const [first, ...rest] = body.view.stages as Record<string, unknown>[];
    await route.fulfill({
      json: {
        ...body,
        view: {
          ...body.view,
          intent: { ...body.view.intent, accept: DECLARED_CHECKS },
          stages: [{ ...first, done_when: ['readme-exists'] }, ...rest],
        },
      },
    });
  });
  const canvas = new WorkflowCanvasPage(page);
  await page.goto(`/#${STUB_LAUNCH_CODE}`);
  await canvas.title.waitFor();
  await canvas.selectTab('Run');
  return canvas;
}

/**
 * Opens the page on the Run view with those params declared. The routes go on
 * before the load, which is why this does not use the `next` fixture.
 */
export async function openDeclaringParams(
  page: Page,
): Promise<WorkflowCanvasPage> {
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await declareParams(page);
  const canvas = new WorkflowCanvasPage(page);
  await page.goto(`/#${STUB_LAUNCH_CODE}`);
  await canvas.title.waitFor();
  await canvas.selectTab('Run');
  return canvas;
}
