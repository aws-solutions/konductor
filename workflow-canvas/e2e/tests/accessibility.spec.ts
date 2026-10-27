// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { test } from '../support/fixtures';
import {
  answerRunsWith,
  refuseRunsWith,
  runReply,
} from '../support/run-routes';
import { TAB_NAMES, WorkflowCanvasPage } from '../support/workflow-canvas-page';

for (const name of TAB_NAMES) {
  test(`${name} tab has no axe violations`, async ({ canvas }) => {
    await canvas.selectTab(name);
    await canvas.expectTabLoaded(name);

    await expectNoAccessibilityViolations(canvas.page);
  });
}

test('Designer tab has no axe violations when the workflow did not load', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);
  await canvas.open('not-the-launch-code');
  await page.getByText('The workflow did not load').waitFor();

  await expectNoAccessibilityViolations(page);
});

// The stub runs one run at a time, so these answer the run calls themselves.
const RUN_STATES = [
  ['a stage running', runReply('running', ['running', 'pending'])],
  ['a failed stage', runReply('halted', ['blocked', 'pending'])],
  ['a passed run', runReply('passed', ['passed', 'passed'])],
] as const;

for (const [name, reply] of RUN_STATES) {
  test(`Execution tab has no axe violations with ${name}`, async ({
    canvas,
  }) => {
    await answerRunsWith(canvas.page, reply);
    await canvas.selectTab('Execution');
    await canvas.expectTabLoaded('Execution');

    await canvas.runButton.click();
    await canvas.badge('node-end').waitFor();

    await expectNoAccessibilityViolations(canvas.page);
  });
}

test('Execution tab has no axe violations with a failed stage in the dark mode', async ({
  canvas,
}) => {
  await answerRunsWith(canvas.page, runReply('halted', ['blocked', 'pending']));
  await canvas.switchTheme();
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.runButton.click();
  await canvas.badge('node-end').waitFor();

  await expectNoAccessibilityViolations(canvas.page);
});

test('Execution tab has no axe violations with the error of the API shown', async ({
  canvas,
}) => {
  await refuseRunsWith(canvas.page, 409, {
    error: 'kiro-cli is not installed.',
    code: 'harness_unavailable',
  });
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.runButton.click();
  await canvas.runError.waitFor();

  await expectNoAccessibilityViolations(canvas.page);
});

test('Execution tab has no axe violations with a goal that cannot be run', async ({
  canvas,
}) => {
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.goal.fill('');
  await canvas.page.getByText('Enter a goal to run.').first().waitFor();

  await expectNoAccessibilityViolations(canvas.page);
});
