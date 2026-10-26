// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';
import {
  answerRunsInTurn,
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
  await expect(canvas.goal).not.toBeEditable();

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

  await expect(canvas.runAlert).toBeEmpty();

  await canvas.runButton.click();

  await expect(canvas.runError).toHaveCount(1);
  await expect(canvas.runError).toContainText('The run did not start');
  await expect(canvas.runError).toContainText('kiro-cli is not installed.');
  await expect(canvas.runStatus).toContainText('See the error above.');
  await expect(canvas.runAlert).toContainText('kiro-cli is not installed.');
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

test('says the run may still be going when it can no longer be followed', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );
  await canvas.page.route('**/api/runs/*', (route) =>
    route.fulfill({
      status: 404,
      json: { error: 'There is no run with this id.', code: 'not_found' },
    }),
  );

  await canvas.runButton.click();

  await expect(canvas.runError).toContainText('The run could not be followed');
  await expect(canvas.runAlert).toContainText('There is no run with this id.');
  await expect(canvas.runAlert).toContainText(
    'The run may still be going on the server.',
  );
});

test('keeps following the run while the Designer tab is open', async ({
  canvas,
}) => {
  const server = await answerRunsInTurn(canvas.page, [
    runReply('running', ['running', 'pending']),
    runReply('passed', ['passed', 'passed']),
  ]);
  await canvas.runButton.click();
  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);

  await canvas.selectTab('Designer');
  await expect
    .poll(server.reads, { timeout: STEP_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(2);
  await expect(canvas.page.getByTestId('status-badge')).toHaveCount(0);
  await canvas.selectTab('Execution');

  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
});

test('keeps the goal that was typed when the person comes back from the Designer tab', async ({
  canvas,
}) => {
  await canvas.goal.fill('Fix the typo');

  await canvas.selectTab('Designer');
  await canvas.selectTab('Execution');

  await expect(canvas.goal).toHaveValue('Fix the typo');
  await expect(canvas.runButton).toBeEnabled();
});

test('shows the goal of the run in flight, read-only, when the person comes back from the Designer tab', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );
  await canvas.goal.fill('Fix the typo');
  const started = canvas.page.waitForRequest('**/api/run');

  await canvas.runButton.click();
  await expect(canvas.runStatus).toContainText('Running draft.');
  expect((await started).postDataJSON()).toEqual({
    params: { goal: 'Fix the typo' },
  });

  await canvas.selectTab('Designer');
  await canvas.selectTab('Execution');

  await expect(canvas.goal).toHaveValue('Fix the typo');
  await expect(canvas.goal).not.toBeEditable();
  await expect(canvas.runButton).toBeDisabled();
});

test('starts the run when Enter is pressed in the goal box, and keeps focus there', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );
  await canvas.goal.focus();

  await canvas.goal.press('Enter');

  await expect(canvas.runStatus).toContainText('Running draft.');
  await expect(canvas.goal).toBeFocused();
});
