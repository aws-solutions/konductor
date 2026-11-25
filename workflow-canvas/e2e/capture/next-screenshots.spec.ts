// SPDX-License-Identifier: Apache-2.0
import {
  answerRunWith,
  expect,
  openDeclaringChecks,
  openDeclaringParams,
  passed,
  runPassed,
  running,
  test,
} from '../support/next-fixtures';
import { saveFullPageScreenshot } from '../support/screenshots';

// Run with `npm run screenshots`. These save the PNGs of the views the page
// now opens with. They assert only what they must to reach the state they
// save.

test('capture the Design view', async ({ next }) => {
  await expect(next.node('node-stage-draft')).toBeVisible();

  await saveFullPageScreenshot(next.page, 'next-design');
});

test('capture the Design view in the dark mode', async ({ next }) => {
  await next.switchTheme();
  await expect(next.node('node-stage-draft')).toBeVisible();

  await saveFullPageScreenshot(next.page, 'next-design-dark');
});

test('capture the Design view with the keys of a stage', async ({ next }) => {
  await next.page.getByRole('tab', { name: 'Properties' }).click();
  await expect(
    next.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByLabel('name', { exact: true }),
  ).toHaveValue('draft');

  await saveFullPageScreenshot(next.page, 'next-design-properties');
});

test('capture the Run view before a run', async ({ next }) => {
  await next.selectTab('Run');
  await expect(next.runButton).toBeVisible();

  await saveFullPageScreenshot(next.page, 'next-run-idle');
});

test('capture the Run view asking for the declared params', async ({
  page,
}) => {
  const canvas = await openDeclaringParams(page);
  await expect(canvas.page.getByLabel('branch')).toHaveValue('main');

  await saveFullPageScreenshot(canvas.page, 'next-run-params');
});

test('capture the Run view after a run has passed', async ({ next }) => {
  await answerRunWith(next.page, [
    running(1, 'draft'),
    passed(2, 'draft'),
    running(3, 'review'),
    passed(4, 'review'),
    runPassed(5),
  ]);
  await next.selectTab('Run');

  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await saveFullPageScreenshot(next.page, 'next-run-passed');
});

test('capture the Run view after a run has passed, in the dark mode', async ({
  next,
}) => {
  await answerRunWith(next.page, [
    running(1, 'draft'),
    passed(2, 'draft'),
    running(3, 'review'),
    passed(4, 'review'),
    runPassed(5),
  ]);
  await next.switchTheme();
  await next.selectTab('Run');

  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await saveFullPageScreenshot(next.page, 'next-run-passed-dark');
});

test('capture the Run view with a verified check and a deferred one', async ({
  page,
}) => {
  const canvas = await openDeclaringChecks(page, {
    'readme-exists': 'verified',
    'tests-pass': 'deferred',
  });
  await answerRunWith(canvas.page, [
    running(1, 'draft'),
    passed(2, 'draft'),
    running(3, 'review'),
    passed(4, 'review'),
    runPassed(5),
  ]);

  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await saveFullPageScreenshot(canvas.page, 'next-run-checks');
});
