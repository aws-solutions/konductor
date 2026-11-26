// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { test } from '../support/fixtures';
import {
  answerRunWith,
  blocked,
  passed,
  refuseRunsWith,
  runFinished,
  runPassed,
  running,
  type RunEventBody,
} from '../support/run-routes';
import { TAB_NAMES, WorkflowCanvasPage } from '../support/workflow-canvas-page';

for (const name of TAB_NAMES) {
  test(`the ${name} view has no axe violations`, async ({ canvas }) => {
    await canvas.selectTab(name);
    await canvas.expectTabLoaded(name);

    await expectNoAccessibilityViolations(canvas.page);
  });
}

test('the page has no axe violations when the workflow did not load', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);
  await canvas.open('not-the-launch-code');
  await page.getByText('The workflow did not load').waitFor();

  await expectNoAccessibilityViolations(page);
});

// The stub runs one run at a time, so these answer the run calls themselves.
const RUN_STATES: readonly (readonly [string, readonly RunEventBody[]])[] = [
  ['a stage running', [running(1, 'draft')]],
  [
    'a stage that stopped the run',
    [blocked(1, 'draft', 'RESULT_MISSING'), runFinished(2, 'halted')],
  ],
  [
    'a run that passed',
    [passed(1, 'draft'), passed(2, 'review'), runPassed(3)],
  ],
];

for (const [name, events] of RUN_STATES) {
  test(`the Run view has no axe violations with ${name}`, async ({
    canvas,
  }) => {
    await answerRunWith(canvas.page, events);
    await canvas.selectTab('Run');
    await canvas.expectTabLoaded('Run');

    await canvas.runButton.click();
    await canvas.runStatus.waitFor();

    await expectNoAccessibilityViolations(canvas.page);
  });
}

test('the Run view has no axe violations with a stopped run in the dark mode', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, [
    blocked(1, 'draft', 'RESULT_MISSING'),
    runFinished(2, 'halted'),
  ]);
  await canvas.switchTheme();
  await canvas.selectTab('Run');
  await canvas.expectTabLoaded('Run');

  await canvas.runButton.click();
  await canvas.runStatus.waitFor();

  await expectNoAccessibilityViolations(canvas.page);
});

test('the Run view has no axe violations with the error of the API shown', async ({
  canvas,
}) => {
  await refuseRunsWith(canvas.page, 409, {
    error: 'kiro-cli is not installed.',
    code: 'harness_unavailable',
  });
  await canvas.selectTab('Run');
  await canvas.expectTabLoaded('Run');

  await canvas.runButton.click();
  await canvas.runError.waitFor();

  await expectNoAccessibilityViolations(canvas.page);
});

test('the Run view has no axe violations with a goal that cannot be run', async ({
  canvas,
}) => {
  await canvas.selectTab('Run');
  await canvas.expectTabLoaded('Run');

  await canvas.goal.fill('');
  await canvas.page.getByText('Enter a goal to run.').first().waitFor();

  await expectNoAccessibilityViolations(canvas.page);
});

// Opens the trust dialog: the Run is refused with `trust_required`.
async function openTrustDialog(canvas: WorkflowCanvasPage) {
  await refuseRunsWith(canvas.page, 409, {
    error: 'The workflow is not trusted yet.',
    code: 'trust_required',
    fix: 'Run `konductor flow trust hello` in a terminal, then try again.',
  });
  await canvas.selectTab('Run');
  await canvas.expectTabLoaded('Run');
  await canvas.runButton.click();
  await canvas.page.getByTestId('trust-command').waitFor();
}

test('the Run view has no axe violations with the trust dialog open', async ({
  canvas,
}) => {
  await openTrustDialog(canvas);

  await expectNoAccessibilityViolations(canvas.page);
});

test('the Run view has no axe violations with the trust dialog open in the dark mode', async ({
  canvas,
}) => {
  await canvas.switchTheme();
  await openTrustDialog(canvas);

  await expectNoAccessibilityViolations(canvas.page);
});
