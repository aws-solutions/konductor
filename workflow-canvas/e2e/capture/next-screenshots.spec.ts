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
import { refuseRunsWith } from '../support/run-routes';
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

test('capture the Design view with a prompt being typed', async ({ next }) => {
  const properties = next.page.getByRole('tabpanel', { name: 'Properties' });
  await next.page.getByRole('tab', { name: 'Properties' }).click();
  const prompt = properties.getByLabel('prompt', { exact: true });
  await expect(prompt).toBeEditable();

  await prompt.fill('Write a warmer greeting to README.md.');
  await expect(next.page.getByTestId('save-status')).toContainText(
    'Unsaved changes',
  );

  await saveFullPageScreenshot(next.page, 'next-design-prompt');
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
  const canvas = await openDeclaringChecks(page);
  await answerRunWith(
    canvas.page,
    [
      running(1, 'draft'),
      passed(2, 'draft'),
      running(3, 'review'),
      passed(4, 'review'),
      runPassed(5),
    ],
    undefined,
    { checks: { 'readme-exists': 'verified', 'tests-pass': 'deferred' } },
  );

  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await saveFullPageScreenshot(canvas.page, 'next-run-checks');
});

// As with the Execution tab's shot of the same dialog, an arm64 host draws
// the dimmed page behind it one level of colour off, so the committed PNG is
// the one that CI draws (see Screenshots in the README).
test('capture the Run view when a run needs trust', async ({ next }) => {
  await refuseRunsWith(next.page, 409, {
    error: 'The workflow is not trusted yet.',
    code: 'trust_required',
    fix: 'Run `konductor flow trust hello` in a terminal, then try again.',
  });
  await next.selectTab('Run');
  await expect(next.runButton).toBeVisible();

  await next.runButton.click();
  await next.page.getByTestId('trust-command').waitFor();

  await saveFullPageScreenshot(next.page, 'next-run-trust-required');
});
