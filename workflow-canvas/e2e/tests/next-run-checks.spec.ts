// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import {
  answerRunWith,
  expect,
  openDeclaringChecks,
  passed,
  runPassed,
  running,
  test,
} from '../support/next-fixtures';
import type { WorkflowCanvasPage } from '../support/workflow-canvas-page';

const RUN_EVENTS = [
  running(1, 'draft'),
  passed(2, 'draft'),
  running(3, 'review'),
  passed(4, 'review'),
  runPassed(5),
];

/**
 * Opens the Run view with those states declared and runs the workflow, which
 * is what makes the page read them: a page with no run reads no run.
 */
async function ranWithChecks(
  page: Page,
  states: Readonly<Record<string, string>>,
): Promise<WorkflowCanvasPage> {
  const canvas = await openDeclaringChecks(page, states);
  await answerRunWith(canvas.page, RUN_EVENTS);
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
  return canvas;
}

test('lists the check the workflow declares, with its state from the run', async ({
  next,
}) => {
  await next.selectTab('Run');

  // The stub's workflow declares one check and no stage waits for it.
  await expect(
    next.page.getByRole('heading', { name: 'Checks' }),
  ).toBeVisible();
  await expect(next.page.getByText('readme-exists')).toBeVisible();
  await expect(next.page.getByText('No stage waits for it.')).toBeVisible();
  await expect(next.page.getByTestId('check-state-readme-exists')).toHaveText(
    'Deferred',
  );
});

test('reads the state from the server once a run has started', async ({
  next,
}) => {
  await next.selectTab('Run');
  const reads: string[] = [];
  next.page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/runs\/[^/]+$/.test(path)) reads.push(path);
  });

  await next.runButton.click();

  // The stub runs the workflow for real here, and its answer is the state of
  // the one check it declares: no stage waits for it, so it stays deferred.
  await expect.poll(() => reads.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(next.page.getByTestId('check-state-readme-exists')).toHaveText(
    'Deferred',
  );
});

test('shows a verified check beside a deferred one', async ({ page }) => {
  const canvas = await ranWithChecks(page, {
    'readme-exists': 'verified',
    'tests-pass': 'deferred',
  });

  await expect(canvas.page.getByTestId('check-state-readme-exists')).toHaveText(
    'Verified',
  );
  await expect(canvas.page.getByTestId('check-state-tests-pass')).toHaveText(
    'Deferred',
  );
  await expect(canvas.page.getByText('Stage draft')).toBeVisible();
});

test('marks the stage with the check it waits for, and no other', async ({
  page,
}) => {
  const canvas = await ranWithChecks(page, {
    'readme-exists': 'verified',
    'tests-pass': 'deferred',
  });

  await expect(canvas.page.getByTestId('stage-check-readme-exists')).toHaveText(
    'readme-exists: Verified',
  );
  await expect(canvas.page.getByTestId('stage-check-tests-pass')).toHaveCount(
    0,
  );
});

test('reads the run for its checks a bounded number of times, never polling', async ({
  page,
}) => {
  const canvas = await openDeclaringChecks(page, {
    'readme-exists': 'verified',
  });
  const reads: string[] = [];
  canvas.page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/runs\/[^/]+$/.test(path)) reads.push(path);
  });
  await answerRunWith(canvas.page, RUN_EVENTS);

  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  // The events of this run arrive in one page, so the run is read once when
  // it starts and once for the change that page brings.
  expect(reads).toHaveLength(2);

  // Nothing reads it again: the wait for a third read runs out, where a page
  // that polled would make one within a second.
  await expect(
    canvas.page.waitForRequest(
      (request) => /^\/api\/runs\/[^/]+$/.test(new URL(request.url()).pathname),
      { timeout: 1500 },
    ),
  ).rejects.toThrow();
  expect(reads).toHaveLength(2);
});

test('draws no checks panel for the views it replaced', async ({ page }) => {
  await page.goto(`/?ui=classic#${STUB_LAUNCH_CODE}`);

  await expect(page.getByRole('heading', { name: 'Checks' })).toHaveCount(0);
});

test('has no accessibility violations with the checks shown', async ({
  page,
}) => {
  const canvas = await ranWithChecks(page, {
    'readme-exists': 'verified',
    'tests-pass': 'deferred',
  });

  await expectNoAccessibilityViolations(canvas.page);
});

test('draws the checks in the dark mode', async ({ page }) => {
  const canvas = await ranWithChecks(page, { 'readme-exists': 'verified' });

  await canvas.switchTheme();

  await expect(canvas.page.getByTestId('check-state-readme-exists')).toHaveText(
    'Verified',
  );
});
