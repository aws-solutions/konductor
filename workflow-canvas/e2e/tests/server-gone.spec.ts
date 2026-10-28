// SPDX-License-Identifier: Apache-2.0
import { test as bare } from '@playwright/test';
import { expect, test } from '../support/editing-fixtures';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

// What the page says when the server is gone or has forgotten the session. The
// stub is shared by every test, so it is not stopped here: the calls are
// answered the way the dev server answers when the stub is down (a 502 with a
// plain-text body that is not the API's) and the way the stub answers after it
// started again (a 401 `unauthorized`). Each message must say what to do next.

const NEXT_AFTER_STOP =
  'If it stopped, start it again and get a fresh launch address from the server.';
const NEXT_AFTER_RESTART = 'Get a fresh launch address from the server.';

const badGateway = {
  status: 502,
  contentType: 'text/plain',
  body: 'Bad Gateway',
};
const sessionGone = {
  status: 401,
  json: {
    error: 'The session token is missing or wrong.',
    code: 'unauthorized',
  },
};

bare(
  'says what to do when the server is down while the page loads',
  async ({ page }) => {
    await page.route('**/api/session', (route) => route.fulfill(badGateway));

    await new WorkflowCanvasPage(page).open('any-launch-code');

    await expect(page.getByText('The workflow did not load')).toBeVisible();
    await expect(page.getByText('The server answered 502.')).toBeVisible();
    await expect(page.getByText(NEXT_AFTER_STOP)).toBeVisible();
  },
);

test('says what to do when the server is down as a run starts', async ({
  canvas,
}) => {
  await canvas.page.route('**/api/run', (route) => route.fulfill(badGateway));
  await canvas.selectTab('Execution');

  await canvas.runButton.click();

  await expect(canvas.runError).toContainText('The server answered 502.');
  await expect(canvas.runError).toContainText(NEXT_AFTER_STOP);
});

test('says what to do when the server forgot the session as a run starts', async ({
  canvas,
}) => {
  await canvas.page.route('**/api/run', (route) => route.fulfill(sessionGone));
  await canvas.selectTab('Execution');

  await canvas.runButton.click();

  await expect(canvas.runError).toContainText(
    'The session token is missing or wrong.',
  );
  await expect(canvas.runError).toContainText(NEXT_AFTER_RESTART);
});

test('says what to do when the server is down as the changes are saved', async ({
  designer,
}) => {
  const { page } = designer;
  await page.route('**/api/workflow', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill(badGateway)
      : route.continue(),
  );
  await designer.stage('draft').click();
  await designer.rename('drafting');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();

  await save.click();

  const alert = page.getByText('The workflow was not saved').locator('..');
  await expect(alert).toContainText('The server answered 502.');
  await expect(alert).toContainText(NEXT_AFTER_STOP);
  await expect(designer.name).toHaveValue('drafting');
});
