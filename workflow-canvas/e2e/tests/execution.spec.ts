// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';
import {
  answerRunsWith,
  dropFirstReadThenAnswerWith,
  joinActiveRunWith,
  refuseRunsWith,
  runReply,
} from '../support/run-routes';
import { STEP_TIMEOUT_MS } from '../support/workflow-canvas-page';

// The stub runs one run at a time. Only the first test here starts a run on
// it, and it waits for the end; the others answer the run calls themselves.

test.beforeEach(async ({ canvas }) => {
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');
});

test('draws the same graph as the Designer, read-only, with a Run button and no states', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  await expect(canvas.runButton).toBeEnabled();
  await expect(canvas.goal).toHaveValue('Add a greeting to the README');
  await expect(canvas.runStatus).toContainText('Ready. Press Run to start.');
  await canvas.expectBadges([null, null, null, null]);
});

test('runs the workflow on the stub: each stage goes from queued to running to done, in order', async ({
  canvas,
}) => {
  await canvas.runButton.click();
  await expect(canvas.runButton).toBeDisabled();
  await expect(canvas.goal).toBeDisabled();

  await expect(canvas.badge('node-stage-draft')).toHaveText('Running', {
    timeout: STEP_TIMEOUT_MS,
  });
  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);
  await expect(canvas.runStatus).toContainText(
    'Running draft. 0 of 2 stages done.',
  );
  await expect(canvas.runButton).toBeDisabled();

  await expect(canvas.badge('node-stage-review')).toHaveText('Running', {
    timeout: STEP_TIMEOUT_MS,
  });
  await canvas.expectBadges(['Done', 'Done', 'Running', 'Queued']);
  await expect(canvas.runStatus).toContainText(
    'Running review. 1 of 2 stages done.',
  );

  await expect(canvas.badge('node-end')).toHaveText('Passed', {
    timeout: STEP_TIMEOUT_MS,
  });
  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
  await expect(canvas.runStatus).toContainText(
    'Run passed. 2 of 2 stages done. Exit code 0.',
  );
  await expect(canvas.runButton).toBeEnabled();
  await expect(canvas.runError).toHaveCount(0);
});

test('announces the status in a polite live region and names the state of each node', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );

  await canvas.runButton.click();

  await expect(canvas.runStatus).toHaveAttribute('role', 'status');
  await expect(canvas.runStatus).toHaveAttribute('aria-live', 'polite');
  await expect(canvas.runStatus).toContainText('Running draft.');
  await expect(
    canvas.nodeNamed(
      'Stage draft, agent k-developer, harness kiro-cli, running',
    ),
  ).toBeVisible();
  await expect(canvas.nodeNamed('End, queued')).toBeVisible();
});

test('shows a failed stage with its words, the stages that will not run, and the halted result', async ({
  canvas,
}) => {
  // The stub never fails a stage, so the reply is made here.
  await answerRunsWith(canvas.page, runReply('halted', ['blocked', 'pending']));

  await canvas.runButton.click();

  await canvas.expectBadges(['Done', 'Failed', 'Not run', 'Halted']);
  await expect(canvas.runStatus).toContainText(
    'Run halted at draft. 0 of 2 stages done. Exit code 1.',
  );
  await expect(canvas.runButton).toBeEnabled();
  await expect(canvas.runError).toHaveCount(0);
});

test('shows the error of the API in one alert when the run does not start', async ({
  canvas,
}) => {
  await refuseRunsWith(canvas.page, 409, {
    error: 'kiro-cli is not installed.',
    code: 'harness_unavailable',
  });

  await canvas.runButton.click();

  await expect(canvas.runError).toHaveCount(1);
  await expect(canvas.runError).toContainText('The run did not start');
  await expect(canvas.runError).toContainText('kiro-cli is not installed.');
  await expect(canvas.runStatus).toContainText('The run did not start.');
  await canvas.expectBadges([null, null, null, null]);
  await expect(canvas.runButton).toBeEnabled();
});

test('follows the run that is already active when the server answers 409 with its id', async ({
  canvas,
}) => {
  await joinActiveRunWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );

  await canvas.runButton.click();

  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);
  await expect(canvas.runStatus).toContainText(
    'Following the run that was already in progress. Running draft.',
  );
  await expect(canvas.runError).toHaveCount(0);
  await expect(canvas.runButton).toBeDisabled();
});

test('keeps following the run when one read of it fails', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );
  await dropFirstReadThenAnswerWith(
    canvas.page,
    runReply('passed', ['passed', 'passed']),
  );

  await canvas.runButton.click();

  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
  await expect(canvas.runError).toHaveCount(0);
});

test('keeps the run going while the Designer tab is open', async ({
  canvas,
}) => {
  await answerRunsWith(canvas.page, runReply('passed', ['passed', 'passed']));
  await canvas.runButton.click();
  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);

  await canvas.selectTab('Designer');
  await expect(canvas.page.getByTestId('status-badge')).toHaveCount(0);
  await canvas.selectTab('Execution');

  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
});
