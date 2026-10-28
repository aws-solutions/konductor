// SPDX-License-Identifier: Apache-2.0
import { expect } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { test } from '../support/fixtures';
import { sharedSession } from '../support/session';

// A reload would ask the server for the page again. A request made after the
// anchor was set is answered after any reload request, so once it is answered
// the page is known not to have reloaded.
test('keeps the workflow on the page when the address gets an anchor', async ({
  canvas,
  page,
}) => {
  const pageRequests: string[] = [];
  await page.route('**/barrier', (route) => route.fulfill({ body: 'ok' }));
  page.on('request', (request) => {
    if (request.isNavigationRequest()) pageRequests.push(request.url());
  });

  await page.evaluate(async () => {
    window.location.hash = '#some-anchor';
    await fetch('/barrier');
  });

  expect(pageRequests).toEqual([]);
  await canvas.expectWorkflowDrawn();
  await expect(page.getByText('The workflow did not load')).toHaveCount(0);
});

const NEW_CODE = 'nQ3x7vJ2kLmN9pRs4TuVw5Y_-ab12';

// The page is not reloaded for a pasted code: it opens a session with it and
// changes only if that works.
test('keeps the workflow when a pasted launch code is refused', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  const sessions: string[] = [];
  await page.route('**/api/session', (route) => {
    sessions.push(route.request().postData() ?? '');
    return route.fulfill({
      status: 401,
      json: { error: 'The launch code is not valid.' },
    });
  });

  await page.evaluate((code) => (window.location.hash = code), NEW_CODE);

  await expect.poll(() => sessions.length).toBe(1);
  expect(sessions[0]).toContain(NEW_CODE);
  await canvas.expectWorkflowDrawn();
  await expect(page.getByText('The workflow did not load')).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByTestId('launch-notice')).toContainText(
    'The launch code is not valid. The open workflow is unchanged.',
  );
});

test('shows the workflow of a pasted launch code once its session is open', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { ...sharedSession(), harness: 'other-harness' } }),
  );

  await page.evaluate((code) => (window.location.hash = code), NEW_CODE);

  await expect(page.getByTestId('node-stage-draft')).toContainText(
    'other-harness',
  );
});

// The launch code works once and the page removes it from the address. A
// reload still works, as the page kept the session in the storage of its tab.
test('draws the workflow again after a reload, with no launch code', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  const sessions: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session')) sessions.push(request.url());
  });

  await page.reload();

  await canvas.expectWorkflowDrawn();
  await expect(page.getByText(/no launch code in the address/)).toHaveCount(0);
  expect(sessions).toEqual([]);
});

test('never writes the launch code to the storage of the page', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();

  const stored = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(window.sessionStorage),
      Object.entries(window.localStorage),
    ]),
  );

  expect(stored).toContain(sharedSession().token);
  expect(stored).not.toContain(STUB_LAUNCH_CODE);
});

test('asks for a fresh launch address when the server no longer knows the session', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  await page.route('**/api/workflow', (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: 'The session token is missing or wrong.',
        code: 'unauthorized',
      },
    }),
  );

  await page.reload();

  await expect(
    page.getByText(/server no longer knows this session/),
  ).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0);

  await page.unroute('**/api/workflow');
  await page.evaluate((code) => (window.location.hash = code), NEW_CODE);

  await canvas.expectWorkflowDrawn();
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(1);
});

test('keeps the old session for a reload when a pasted launch code is refused', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: 'The launch code is not valid.' },
    }),
  );
  await page.evaluate((code) => (window.location.hash = code), NEW_CODE);
  await expect(page.getByTestId('launch-notice')).toBeVisible();

  await page.reload();

  await canvas.expectWorkflowDrawn();
});
