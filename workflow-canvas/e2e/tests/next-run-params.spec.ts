// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page, type Request } from '@playwright/test';
import { openDeclaringParams } from '../support/next-fixtures';

const RUN_ID = '20261024-0412-a7b3c';

/** Answers the start, and keeps the request so a test can read its params. */
async function catchStart(page: Page): Promise<() => Request | undefined> {
  let asked: Request | undefined;
  await page.route('**/api/run', (route) => {
    asked = route.request();
    return route.fulfill({ status: 202, json: { run_id: RUN_ID } });
  });
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route('**/api/runs/*/events*', (route) =>
    route.fulfill({ json: { events: [], next: 0, finished: true } }),
  );
  return () => asked;
}

const paramsOf = (request: Request | undefined) =>
  (request?.postDataJSON() as { params: Record<string, string> } | undefined)
    ?.params;

test('asks for the params the workflow declares, with their defaults', async ({
  page,
}) => {
  const canvas = await openDeclaringParams(page);

  await expect(canvas.page.getByLabel('diff_input')).toHaveValue('');
  await expect(canvas.page.getByLabel('branch')).toHaveValue('main');
  await expect(canvas.page.getByText('The diff to read.')).toBeVisible();
});

test('keeps Run off until a required param has a value', async ({ page }) => {
  const canvas = await openDeclaringParams(page);

  await expect(canvas.runButton).toBeDisabled();

  await canvas.page.getByLabel('diff_input').fill('the.diff');

  await expect(canvas.runButton).toBeEnabled();
});

test('starts the run with the goal and the params in the boxes', async ({
  page,
}) => {
  const canvas = await openDeclaringParams(page);
  const started = await catchStart(page);
  await canvas.page.getByLabel('diff_input').fill('the.diff');
  await canvas.page.getByLabel('branch').fill('release');

  await canvas.runButton.click();

  await expect
    .poll(() => paramsOf(started()))
    .toEqual({
      goal: 'Add a greeting to the README',
      diff_input: 'the.diff',
      branch: 'release',
    });
});

test('leaves an empty box out, so the server applies the default', async ({
  page,
}) => {
  const canvas = await openDeclaringParams(page);
  const started = await catchStart(page);
  await canvas.page.getByLabel('diff_input').fill('the.diff');
  await canvas.page.getByLabel('branch').fill('');

  await canvas.runButton.click();

  await expect
    .poll(() => paramsOf(started()))
    .toEqual({
      goal: 'Add a greeting to the README',
      diff_input: 'the.diff',
    });
});

test('shows what the server says about a param it refuses', async ({
  page,
}) => {
  const canvas = await openDeclaringParams(page);
  await canvas.page.getByLabel('diff_input').fill('the.diff');

  // The start goes to the stub, whose saved file declares neither param, so
  // it answers with its own sentence and this page shows it.
  await canvas.runButton.click();

  await expect(canvas.page.getByTestId('run-start-error')).toContainText(
    'does not declare the param',
  );
});
