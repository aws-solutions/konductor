// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/editing-fixtures';
import { openDeclaringChecks, openDeclaringParams } from '../support/fixtures';
import {
  answerRunWith,
  blocked,
  passed,
  refuseRunsWith,
  runFinished,
  runPassed,
  runRow,
  running,
} from '../support/run-routes';
import { saveFullPageScreenshot } from '../support/screenshots';
import { overwriteWorkflow, SAMPLE_TEXT } from '../support/stub-workflow';

// Run with `npm run screenshots`. These save the PNGs of the page views. They
// assert only what they must to reach the state they save.

test('capture the Library list', async ({ canvas }) => {
  await canvas.selectTab('Library');
  await expect(
    canvas.page.getByText('Adversarial pull request review'),
  ).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-library');
});

test('capture the Library list in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.selectTab('Library');
  await expect(
    canvas.page.getByText('Adversarial pull request review'),
  ).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-library-dark');
});

test('capture a read-only Library workflow', async ({ canvas }) => {
  await canvas.selectTab('Library');
  await canvas.page
    .getByRole('button', { name: 'Open Adversarial pull request review' })
    .click();
  await expect(canvas.page.getByTestId('read-only-note')).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-library-entry');
});

test('capture a read-only Library workflow in the dark mode', async ({
  canvas,
}) => {
  await canvas.switchTheme();
  await canvas.selectTab('Library');
  await canvas.page
    .getByRole('button', { name: 'Open Adversarial pull request review' })
    .click();
  await expect(canvas.page.getByTestId('read-only-note')).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-library-entry-dark');
});

test('capture the Design view', async ({ canvas }) => {
  await expect(canvas.node('node-stage-draft')).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-design');
});

test('capture the Design view in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();
  await expect(canvas.node('node-stage-draft')).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-design-dark');
});

test('capture the Design view with the keys of a stage', async ({ canvas }) => {
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  await expect(
    canvas.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByLabel('name', { exact: true }),
  ).toHaveValue('draft');

  await saveFullPageScreenshot(canvas.page, 'next-design-properties');
});

test('capture the stage panel in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  await expect(
    canvas.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByText('Other fields'),
  ).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-design-properties-dark');
});

test('capture the Design view with a stage output', async ({ canvas }) => {
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  const panel = canvas.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add output' }).click();
  await panel.getByRole('textbox', { name: 'Output name 1' }).fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');

  await saveFullPageScreenshot(canvas.page, 'next-design-outputs');
});

test('capture the Design view with acceptance checks', async ({ canvas }) => {
  await canvas.page
    .getByRole('button', { name: /checks 1, edit acceptance checks/ })
    .click();
  await expect(
    canvas.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByRole('textbox', { name: 'Check file 1' }),
  ).toHaveValue('README.md');

  await saveFullPageScreenshot(canvas.page, 'next-design-checks');
});

test('capture the check editor in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.page
    .getByRole('button', { name: /checks 1, edit acceptance checks/ })
    .click();
  await expect(
    canvas.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByRole('textbox', { name: 'Check file 1' }),
  ).toHaveValue('README.md');

  await saveFullPageScreenshot(canvas.page, 'next-design-checks-dark');
});

test('capture the Design view with workflow parameters', async ({ canvas }) => {
  await canvas.page
    .getByRole('button', {
      name: 'params 1, edit declared parameters',
    })
    .click();
  await expect(
    canvas.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByRole('textbox', { name: 'description' }),
  ).toHaveValue('What the workflow should accomplish.');

  await saveFullPageScreenshot(canvas.page, 'next-design-params');
});

test('capture the filtered Components tray', async ({ canvas }) => {
  await canvas.page
    .getByRole('searchbox', { name: 'Filter components' })
    .fill('architect');
  await expect(
    canvas.page
      .getByRole('region', { name: 'Components' })
      .getByRole('button', { name: /k-architect/ }),
  ).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-design-tray');
});

test('capture the Design view with a prompt being typed', async ({
  canvas,
}) => {
  const properties = canvas.page.getByRole('tabpanel', { name: 'Properties' });
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  const prompt = properties.getByLabel('prompt', { exact: true });
  await expect(prompt).toBeEditable();

  await prompt.fill('Write a warmer greeting to README.md.');
  await expect(canvas.page.getByTestId('save-status')).toContainText(
    'Unsaved changes',
  );

  await saveFullPageScreenshot(canvas.page, 'next-design-prompt');
});

test('capture the Run view before a run', async ({ canvas }) => {
  await canvas.selectTab('Run');
  await expect(canvas.runButton).toBeVisible();

  await saveFullPageScreenshot(canvas.page, 'next-run-idle');
});

test('capture the Run view asking for the declared params', async ({
  page,
}) => {
  const canvas = await openDeclaringParams(page);
  await expect(canvas.page.getByLabel('branch')).toHaveValue('main');

  await saveFullPageScreenshot(canvas.page, 'next-run-params');
});

test('capture the Run view after a run has passed', async ({ canvas }) => {
  await answerRunWith(canvas.page, [
    running(1, 'draft'),
    passed(2, 'draft'),
    running(3, 'review'),
    passed(4, 'review'),
    runPassed(5),
  ]);
  await canvas.selectTab('Run');

  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await saveFullPageScreenshot(canvas.page, 'next-run-passed');
});

test('capture the Run view after a run has passed, in the dark mode', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, [
    running(1, 'draft'),
    passed(2, 'draft'),
    running(3, 'review'),
    passed(4, 'review'),
    runPassed(5),
  ]);
  await canvas.switchTheme();
  await canvas.selectTab('Run');

  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await saveFullPageScreenshot(canvas.page, 'next-run-passed-dark');
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

// With the dialog open, an arm64 host draws the dimmed page behind it one
// level of colour off, so the committed PNG is the one that CI draws (see
// Screenshots in the README).
test('capture the Run view when a run needs trust', async ({ canvas }) => {
  await refuseRunsWith(canvas.page, 409, {
    error: 'The workflow is not trusted yet.',
    code: 'trust_required',
    fix: 'Run `konductor flow trust hello` in a terminal, then try again.',
  });
  await canvas.selectTab('Run');
  await expect(canvas.runButton).toBeVisible();

  await canvas.runButton.click();
  await canvas.page.getByTestId('trust-command').waitFor();

  await saveFullPageScreenshot(canvas.page, 'next-run-trust-required');
});

// The runs below answer with fixed replies, not a run on the stub, so a
// capture never races the three seconds that a stage takes there.
test('capture the Run view while the first stage runs', async ({ canvas }) => {
  // A run that is still going shows an elapsed time read from the clock, so
  // the clock is held at a fixed instant six seconds after the `started_at`
  // of the row below. Without this the label, and the PNG with it, change
  // with the moment of the capture. Only the clock is fixed, not the timers,
  // so the follower still reads the run.
  await canvas.page.clock.setFixedTime(new Date('2026-10-24T04:12:11Z'));
  await answerRunWith(canvas.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await canvas.selectTab('Run');
  await expect(canvas.runButton).toBeVisible();

  await canvas.runButton.click();
  await expect(canvas.runStatus).toContainText('Running draft.');
  await expect(canvas.runStatus).toContainText('Elapsed 0:06');
  // The pointer and the focus are still on Run, which is now off and shows its
  // reason in a tooltip; a capture takes the page without it.
  await canvas.page.mouse.move(0, 0);
  await canvas.runButton.blur();

  await saveFullPageScreenshot(canvas.page, 'next-run-running');
});

test('capture the Run view after a stage stopped the run', async ({
  canvas,
}) => {
  await answerRunWith(
    canvas.page,
    [
      passed(1, 'draft'),
      blocked(2, 'review', 'OUTPUT_MISSING'),
      runFinished(3, 'halted'),
    ],
    [runRow('halted')],
  );
  await canvas.selectTab('Run');
  await expect(canvas.runButton).toBeVisible();

  await canvas.runButton.click();
  await expect(canvas.runStatus).toContainText('Run halted at review.');

  await saveFullPageScreenshot(canvas.page, 'next-run-halted');
});

// Editing. Each test puts the stub's workflow back afterwards (the fixture
// does), so the captures above and below it see the sample.
test('capture the Design view with unsaved edits', async ({ designer }) => {
  await designer.chooseAgent('k-architect');
  await designer.stage('review').click();
  await designer.rename('ship');
  await designer.expectStatus('Unsaved changes');

  await saveFullPageScreenshot(designer.page, 'next-design-editing');
});

test('capture the Design view with unsaved edits in the dark mode', async ({
  canvas,
  designer,
}) => {
  await canvas.switchTheme();
  await designer.chooseAgent('k-architect');
  await designer.stage('review').click();
  await designer.rename('ship');
  await designer.expectStatus('Unsaved changes');

  await saveFullPageScreenshot(designer.page, 'next-design-editing-dark');
});

test('capture the Design view after a save', async ({ designer }) => {
  await designer.rename('write');
  await designer.save.click();
  await designer.expectStatus('Saved');

  await saveFullPageScreenshot(designer.page, 'next-design-saved');
});

test('capture the Design view with a problem the server found', async ({
  designer,
}) => {
  await designer.stage('review').click();
  await designer.rename('draft');
  // The problems of the text are in the YAML pane, beside the drawing.
  await designer.openYaml();
  await expect(designer.problems).toBeVisible();

  await saveFullPageScreenshot(designer.page, 'next-design-problems');
});

test('capture the Design view when the file changed on disk', async ({
  designer,
  request,
}) => {
  await designer.rename('write');
  await overwriteWorkflow(
    request,
    SAMPLE_TEXT.replace('k-quality-assurance', 'k-tpm'),
  );
  await designer.save.click();
  await expect(designer.conflict).toBeVisible();

  await saveFullPageScreenshot(designer.page, 'next-design-conflict');
});

test('capture the Design view with a change it cannot write in place', async ({
  canvas,
  designer,
  request,
}) => {
  await overwriteWorkflow(
    request,
    SAMPLE_TEXT.replace(
      /  - name: review\n    agent: k-quality-assurance\n(    outcome: .*\n)?(    prompt_file: .*\n)?/,
      '  - {name: review, agent: k-quality-assurance}\n',
    ),
  );
  await canvas.page.reload();
  await designer.openProperties();
  await designer.stage('review').click();
  await designer.rename('check');
  await expect(designer.page.getByTestId('not-in-place')).toBeVisible();

  await saveFullPageScreenshot(designer.page, 'next-design-not-in-place');
});

test('capture the Design view with a stage that reads its prompt from a file', async ({
  canvas,
  designer,
  request,
}) => {
  await overwriteWorkflow(
    request,
    SAMPLE_TEXT.replace(
      '    agent: k-quality-assurance\n',
      '    agent: k-quality-assurance\n    prompt_file: review.md\n',
    ),
  );
  await canvas.page.reload();
  await designer.openProperties();
  await designer.stage('review').click();
  await expect(designer.promptFile).toHaveValue('review.md');

  await saveFullPageScreenshot(designer.page, 'next-design-prompt-file');
});
