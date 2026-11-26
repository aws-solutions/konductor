// SPDX-License-Identifier: Apache-2.0
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import {
  answerRunWith,
  expect,
  passed,
  runPassed,
  runRow,
  running,
  test,
} from '../support/next-fixtures';
import { sharedSession } from '../support/session';

/** Another launch address, as a person pastes one. */
const OTHER_CODE = 'nQ3x7vJ2kLmN9pRs4TuVw5Y_-ab12';

/** The run id that every run of these tests is given. */
const RUN_ID = '20261024-0412-a7b3c';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

const RUN_EVENTS = [
  running(1, 'draft'),
  passed(2, 'draft'),
  running(3, 'review'),
  passed(4, 'review'),
  runPassed(5),
];

const stopMark = (canvas: WorkflowCanvasPage) =>
  canvas.graph.getByRole('img', { name: /^The run ends after/ });

test('draws the stages of the workflow, the last one with a stop mark', async ({
  next,
}) => {
  await expect(next.node('node-stage-draft')).toBeVisible();
  await expect(next.node('node-stage-review')).toBeVisible();
  await expect(stopMark(next)).toHaveAccessibleName(
    'The run ends after review',
  );
  await expect(next.graph.getByTestId('node-end')).toHaveCount(0);
});

test('says that the text of the workflow cannot be typed into yet', async ({
  next,
}) => {
  await expect(next.page.getByTestId('raw-edit-note')).toContainText(
    'cannot be typed into here yet',
  );
});

test('shows the text of the workflow under YAML', async ({ next }) => {
  const yaml = next.page.getByRole('tabpanel', { name: 'YAML' });

  await expect(yaml).toContainText('name: hello');
  await expect(yaml).toContainText('agent: k-developer');
});

test('shows the keys of the picked stage under Properties', async ({
  next,
}) => {
  await next.page.getByRole('tab', { name: 'Properties' }).click();
  const properties = next.page.getByRole('tabpanel', { name: 'Properties' });

  await expect(properties.getByLabel('name', { exact: true })).toHaveValue(
    'draft',
  );
  await expect(properties.getByLabel('prompt', { exact: true })).toBeVisible();
  await expect(properties.getByLabel('prompt_file')).toBeVisible();
});

test('opens the stage that is clicked in the drawing', async ({ next }) => {
  await next.node('node-stage-review').click();
  await next.page.getByRole('tab', { name: 'Properties' }).click();

  await expect(
    next.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByLabel('name', { exact: true }),
  ).toHaveValue('review');
});

test('checks a changed stage and marks its lines in the text', async ({
  next,
}) => {
  await next.page.getByRole('tab', { name: 'Properties' }).click();
  const name = next.page
    .getByRole('tabpanel', { name: 'Properties' })
    .getByLabel('name', { exact: true });

  await name.fill('drafting');

  await expect(next.page.getByTestId('yaml-check-status')).toContainText(
    'The text is valid',
  );
  await next.page.getByRole('tab', { name: 'YAML' }).click();
  await expect(next.page.getByRole('tabpanel', { name: 'YAML' })).toContainText(
    'are stage drafting',
  );
});

test('goes back to the text before an edit, and comes back to it', async ({
  next,
}) => {
  await next.page.getByRole('tab', { name: 'Properties' }).click();
  await next.page
    .getByRole('tabpanel', { name: 'Properties' })
    .getByLabel('name', { exact: true })
    .fill('drafting');

  await next.page.getByRole('button', { name: 'Undo' }).click();

  await expect(next.page.getByTestId('earlier-text-note')).toBeVisible();
  await next.page.getByRole('button', { name: 'Redo' }).click();
  await expect(next.page.getByTestId('earlier-text-note')).toHaveCount(0);
});

test('opens the Run view with the default goal of the workflow', async ({
  next,
}) => {
  await next.selectTab('Run');

  await expect(next.goal).toHaveValue('Add a greeting to the README');
  await expect(next.runButton).toBeEnabled();
  await expect(next.page.getByText('No run yet.')).toBeVisible();
});

test('follows a run to Passed and lists it among the past runs', async ({
  next,
}) => {
  await answerRunWith(next.page, RUN_EVENTS);
  await next.selectTab('Run');

  await next.runButton.click();

  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
  await expect(next.page.getByTestId('run-history-row')).toHaveCount(1);
});

test('offers another run once the run has passed, with the goal to edit', async ({
  next,
}) => {
  await answerRunWith(next.page, RUN_EVENTS);
  await next.selectTab('Run');

  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await expect(next.goal).toHaveValue('Add a greeting to the README');
  await expect(next.goal).toBeEditable();
  await expect(next.runButton).toBeEnabled();
});

test('does not take a run that has passed up again after a reload', async ({
  next,
}) => {
  await answerRunWith(next.page, RUN_EVENTS);
  await next.selectTab('Run');
  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await next.page.reload();
  await next.title.waitFor();
  await next.selectTab('Run');

  await expect(next.page.getByText('No run yet.')).toBeVisible();
  await expect(next.goal).toHaveValue('Add a greeting to the README');
  await expect(next.runButton).toBeEnabled();
});

test('follows one run after a reload, and takes its stages only from the events', async ({
  next,
}) => {
  await answerRunWith(next.page, RUN_EVENTS);
  const reads: string[] = [];
  next.page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/runs')) reads.push(path);
  });
  await next.selectTab('Run');
  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
  const whileRunning = reads.filter((path) =>
    /^\/api\/runs\/[^/]+$/.test(path),
  ).length;

  await next.page.reload();
  await next.title.waitFor();
  await next.selectTab('Run');

  // The run that passed is forgotten, so nothing is followed. The whole run
  // is read only for the state of its checks, and the reloaded page, which
  // follows no run, reads it no further.
  await expect(next.page.getByText('No run yet.')).toBeVisible();
  expect(
    reads.filter((path) => /^\/api\/runs\/[^/]+$/.test(path)),
  ).toHaveLength(whileRunning);
});

test('follows a run that is still going once after a reload', async ({
  next,
}) => {
  await answerRunWith(next.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await next.selectTab('Run');
  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText('draft');

  const follows: string[] = [];
  next.page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/events')) follows.push(path);
  });
  await next.page.reload();
  await next.title.waitFor();
  await next.selectTab('Run');
  await expect(next.page.getByTestId('run-progress')).toContainText('draft');

  // One follower reads the run: the events of one run id, and no read of the
  // whole run beside it.
  expect(new Set(follows).size).toBe(1);
  await expect(next.goal).toHaveValue('');
});

test('follows the run through a look at the Design view, and drops it for another workflow', async ({
  next,
}) => {
  await answerRunWith(next.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await next.selectTab('Run');
  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText('draft');

  // The page follows the run, so the Design view takes no follower off it.
  await next.selectTab('Design');
  await answerRunWith(
    next.page,
    [running(1, 'draft'), passed(2, 'draft'), running(3, 'review')],
    [runRow('running')],
    { finished: false },
  );
  await next.page.waitForResponse((answer) => answer.url().includes('/events'));
  await next.selectTab('Run');

  // What came while the Design view was up is on the page.
  await expect(next.page.getByTestId('run-progress')).toContainText('review');

  // Another workflow is another session, so its Run view follows no run of
  // the one that was left. The session of the pasted address is one the
  // server knows, so the load works and the page really swaps.
  await next.page.route('**/api/session', (route) =>
    route.fulfill({ json: { ...sharedSession(), harness: 'other-harness' } }),
  );
  const asked = next.page.waitForEvent('dialog');
  await next.page.evaluate((code) => (window.location.hash = code), OTHER_CODE);
  await (await asked).accept();
  await next.title.waitFor();
  await next.selectTab('Run');
  await expect(next.page.getByText('No run yet.')).toBeVisible();

  // Nothing reads the run of the workflow that was left: the wait for such a
  // read runs out, where a follower still on it would read within a second.
  await expect(
    next.page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `/api/runs/${RUN_ID}/events`,
      { timeout: 1500 },
    ),
  ).rejects.toThrow();
  await expect(next.goal).toBeEditable();
});

test('carries a run reloaded part-way through to its end', async ({ next }) => {
  await answerRunWith(next.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await next.selectTab('Run');
  await next.runButton.click();
  await expect(next.page.getByTestId('run-progress')).toContainText('draft');
  await next.page.reload();
  await next.title.waitFor();
  await next.selectTab('Run');
  await expect(next.page.getByTestId('run-progress')).toContainText('draft');

  // The run ends while the reloaded page follows it.
  await answerRunWith(next.page, RUN_EVENTS);

  await expect(next.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
  await expect(next.page.getByText('No run yet.')).toBeHidden();
  await expect(next.goal).toHaveValue('Add a greeting to the README');
  await expect(next.runButton).toBeEnabled();
});

test('draws the views it replaced through ?ui=classic', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  const canvas = new WorkflowCanvasPage(page);

  await canvas.open(STUB_LAUNCH_CODE);

  await expect(canvas.node('node-end')).toBeVisible();
  await expect(page.getByTestId('raw-edit-note')).toHaveCount(0);
});

test('has no accessibility violations on either view', async ({ next }) => {
  await expectNoAccessibilityViolations(next.page);

  await next.selectTab('Run');

  await expectNoAccessibilityViolations(next.page);
});

test('draws both views in the dark mode', async ({ next }) => {
  await next.switchTheme();

  await expect(stopMark(next)).toBeVisible();

  await next.selectTab('Run');

  await expect(next.runButton).toBeVisible();
});
