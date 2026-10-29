// SPDX-License-Identifier: Apache-2.0
import { expect } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { test } from '../support/fixtures';
import { sharedSession } from '../support/session';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

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

// The code is spent once the session opens. If the first load of the workflow
// fails after that, the session must still be there for a reload.
test('resumes after a reload when the first load failed after the code worked', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await page.route('**/api/workflow', (route) =>
    route.fulfill({ status: 500, json: { error: 'Server error.' } }),
  );
  await page.goto(`/#${STUB_LAUNCH_CODE}`);
  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await page.unroute('**/api/workflow');

  await page.reload();

  await canvas.expectWorkflowDrawn();
});

test('opens the kept session when the code in the address is spent', async ({
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

  await page.goto(`/?again#${NEW_CODE}`);

  await canvas.expectWorkflowDrawn();
  await expect(page.getByTestId('launch-notice')).toContainText(
    'The launch code is not valid. The open workflow is unchanged.',
  );
});

// The tab holds a session from an earlier server run. The fresh address works,
// but its first load fails and the dead session answers 401: a reload must
// still resume with the session of the fresh address.
test('resumes after a reload when a fresh address opens over a dead session and its first load fails', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);
  await page.goto('/?dead');
  await page.evaluate(() =>
    window.sessionStorage.setItem(
      'konductor-workflow-canvas-session',
      JSON.stringify({ token: 'dead-token', harness: 'old-harness' }),
    ),
  );
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await page.route('**/api/workflow', (route) =>
    route.request().headers()['authorization'] === 'Bearer dead-token'
      ? route.fulfill({
          status: 401,
          json: { error: 'The session token is missing or wrong.' },
        })
      : route.fulfill({ status: 500, json: { error: 'Server error.' } }),
  );
  await page.goto(`/?fresh#${STUB_LAUNCH_CODE}`);
  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await page.unroute('**/api/workflow');

  await page.reload();

  await canvas.expectWorkflowDrawn();
});

// The tab shows a workflow, but the server has since forgotten its session. A
// pasted address opens a fresh session whose first load fails. A reload must
// resume the pasted session, since the address cannot be used again.
test('resumes a pasted address after a reload when its first load failed and the shown session is dead', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  const shown = sharedSession();
  const pastedAuthorization = 'Bearer pasted-token';
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { ...shown, token: 'pasted-token' } }),
  );
  const authorizations: string[] = [];
  let pastedLoads = 0;
  await page.route('**/api/workflow', async (route) => {
    const authorization = route.request().headers()['authorization'] ?? '';
    authorizations.push(authorization);
    if (authorization !== pastedAuthorization) {
      return route.fulfill({
        status: 401,
        json: { error: 'The session token is missing or wrong.' },
      });
    }
    if ((pastedLoads += 1) === 1) {
      return route.fulfill({
        status: 500,
        json: { error: 'Server error.' },
      });
    }
    return route.fulfill({
      response: await route.fetch({
        headers: {
          ...route.request().headers(),
          authorization: `Bearer ${shown.token}`,
        },
      }),
    });
  });
  await page.evaluate((code) => (window.location.hash = code), NEW_CODE);
  await expect(page.getByTestId('launch-notice')).toBeVisible();
  authorizations.length = 0;

  await page.reload();

  await canvas.expectWorkflowDrawn();
  expect(authorizations).toEqual([pastedAuthorization]);
});
