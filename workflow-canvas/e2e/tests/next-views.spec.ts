// SPDX-License-Identifier: Apache-2.0
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { HELLO_VIEW } from '../../src/test-support/fixtures';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/fixtures';
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
  canvas,
}) => {
  await expect(canvas.node('node-stage-draft')).toBeVisible();
  await expect(canvas.node('node-stage-review')).toBeVisible();
  await expect(stopMark(canvas)).toHaveAccessibleName(
    'The run ends after review',
  );
});

test('offers the text of the workflow to type over', async ({ canvas }) => {
  const box = canvas.page.getByTestId('yaml-text');

  await expect(box).toBeEditable();
  await expect(box).toHaveValue(/name: hello/);
});

test('saves the text shown after Undo and Redo over a raw edit', async ({
  canvas,
}) => {
  const savedView = {
    ...HELLO_VIEW,
    stages: HELLO_VIEW.stages.map((stage, index) =>
      index === 0 ? { ...stage, name: 'drafting' } : stage,
    ),
  };
  const saved: string[] = [];
  await canvas.page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON() as { text?: unknown };
    if (typeof body.text !== 'string') throw new Error('Save has no text.');
    saved.push(body.text);
    await route.fulfill({
      json: {
        hash: String.fromCharCode(97 + saved.length).repeat(64),
        view: savedView,
        diagnostics: [],
      },
    });
  });
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  await canvas.page.getByLabel('name', { exact: true }).fill('drafting');
  await canvas.page.getByRole('tab', { name: 'YAML' }).click();
  const yaml = canvas.page.getByTestId('yaml-text');
  const beforeRaw = await yaml.inputValue();
  const typed = `${beforeRaw}# typed over\n`;
  await yaml.fill(typed);

  await canvas.page.keyboard.press('ControlOrMeta+z');

  await expect(yaml).toHaveValue(beforeRaw);
  await canvas.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(canvas.page.getByTestId('save-status')).toHaveText('Saved');
  expect(saved).toEqual([beforeRaw]);

  await canvas.page.keyboard.press('ControlOrMeta+Shift+z');

  await expect(yaml).toHaveValue(typed);
  await canvas.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(canvas.page.getByTestId('save-status')).toHaveText('Saved');
  expect(saved).toEqual([beforeRaw, typed]);
});

test('shows the text of the workflow under YAML', async ({ canvas }) => {
  const yaml = canvas.page.getByRole('tabpanel', { name: 'YAML' });

  await expect(yaml).toContainText('name: hello');
  await expect(yaml).toContainText('agent: k-developer');
});

test('shows the keys of the picked stage under Properties', async ({
  canvas,
}) => {
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  const properties = canvas.page.getByRole('tabpanel', { name: 'Properties' });

  await expect(properties.getByLabel('name', { exact: true })).toHaveValue(
    'draft',
  );
  await expect(properties.getByLabel('prompt', { exact: true })).toBeVisible();
  await expect(properties.getByLabel('prompt_file')).toBeVisible();
});

test('opens the stage that is clicked in the drawing', async ({ canvas }) => {
  await canvas.node('node-stage-review').click();
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();

  await expect(
    canvas.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByLabel('name', { exact: true }),
  ).toHaveValue('review');
});

test('checks a changed stage and marks its lines in the text', async ({
  canvas,
}) => {
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  const name = canvas.page
    .getByRole('tabpanel', { name: 'Properties' })
    .getByLabel('name', { exact: true });

  await name.fill('drafting');

  await expect(canvas.page.getByTestId('yaml-check-status')).toContainText(
    'The text is valid',
  );
  await canvas.page.getByRole('tab', { name: 'YAML' }).click();
  await expect(
    canvas.page.getByRole('tabpanel', { name: 'YAML' }),
  ).toContainText('are stage drafting');
});

test('goes back to the text before an edit, and comes back to it', async ({
  canvas,
}) => {
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  await canvas.page
    .getByRole('tabpanel', { name: 'Properties' })
    .getByLabel('name', { exact: true })
    .fill('drafting');

  await canvas.page.getByRole('button', { name: 'Undo' }).click();

  await expect(canvas.page.getByTestId('earlier-text-note')).toBeVisible();
  await canvas.page.getByRole('button', { name: 'Redo' }).click();
  await expect(canvas.page.getByTestId('earlier-text-note')).toHaveCount(0);
});

test('opens the Run view with the default goal of the workflow', async ({
  canvas,
}) => {
  await canvas.selectTab('Run');

  await expect(canvas.goal).toHaveValue('Add a greeting to the README');
  await expect(canvas.runButton).toBeEnabled();
  await expect(canvas.page.getByText('No run yet.')).toBeVisible();
});

test('follows a run to Passed and lists it among the past runs', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, RUN_EVENTS);
  await canvas.selectTab('Run');

  await canvas.runButton.click();

  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
  await expect(canvas.page.getByTestId('run-history-row')).toHaveCount(1);
});

test('shows and announces why a stage halted the run', async ({ canvas }) => {
  await answerRunWith(canvas.page, [
    blocked(1, 'draft', 'RESULT_MISSING'),
    runFinished(2, 'halted'),
  ]);
  await canvas.selectTab('Run');

  await canvas.runButton.click();

  const sentence = 'The final message of the session has no result line.';
  await expect(canvas.page.getByText(sentence, { exact: true })).toBeVisible();
  await expect(canvas.runLiveStatus).toContainText(sentence);
});

test('offers another run once the run has passed, with the goal to edit', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, RUN_EVENTS);
  await canvas.selectTab('Run');

  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await expect(canvas.goal).toHaveValue('Add a greeting to the README');
  await expect(canvas.goal).toBeEditable();
  await expect(canvas.runButton).toBeEnabled();
});

test('does not take a run that has passed up again after a reload', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, RUN_EVENTS);
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await canvas.page.reload();
  await canvas.title.waitFor();
  await canvas.selectTab('Run');

  await expect(canvas.page.getByText('No run yet.')).toBeVisible();
  await expect(canvas.goal).toHaveValue('Add a greeting to the README');
  await expect(canvas.runButton).toBeEnabled();
});

test('follows one run after a reload, and reads it only through the events', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, RUN_EVENTS);
  const reads: string[] = [];
  canvas.page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/runs')) reads.push(path);
  });
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );

  await canvas.page.reload();
  await canvas.title.waitFor();
  await canvas.selectTab('Run');

  // The passed run is forgotten. A whole-run read was only for its checks.
  await expect(canvas.page.getByText('No run yet.')).toBeVisible();
  const whileRunning = reads.filter((path) =>
    /^\/api\/runs\/[^/]+$/.test(path),
  ).length;
  expect(
    reads.filter((path) => /^\/api\/runs\/[^/]+$/.test(path)),
  ).toHaveLength(whileRunning);
});

test('follows a run that is still going once after a reload', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText('draft');

  const follows: string[] = [];
  canvas.page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/events')) follows.push(path);
  });
  await canvas.page.reload();
  await canvas.title.waitFor();
  await canvas.selectTab('Run');
  await expect(canvas.page.getByTestId('run-progress')).toContainText('draft');

  // One follower reads the run: the events of one run id, and no read of the
  // whole run beside it.
  expect(new Set(follows).size).toBe(1);
  await expect(canvas.goal).toHaveValue('');
});

test('follows the run through a look at the Design view, and drops it for another workflow', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText('draft');

  // The page follows the run, so the Design view takes no follower off it.
  await canvas.selectTab('Design');
  await answerRunWith(
    canvas.page,
    [running(1, 'draft'), passed(2, 'draft'), running(3, 'review')],
    [runRow('running')],
    { finished: false },
  );
  await canvas.page.waitForResponse((answer) =>
    answer.url().includes('/events'),
  );
  await canvas.selectTab('Run');

  // What came while the Design view was up is on the page.
  await expect(canvas.page.getByTestId('run-progress')).toContainText('review');

  // Another workflow is another session, so its Run view follows no run of
  // the one that was left. The session of the pasted address is one the
  // server knows, so the load works and the page really swaps.
  await canvas.page.route('**/api/session', (route) =>
    route.fulfill({ json: { ...sharedSession(), harness: 'other-harness' } }),
  );
  const asked = canvas.page.waitForEvent('dialog');
  await canvas.page.evaluate(
    (code) => (window.location.hash = code),
    OTHER_CODE,
  );
  await (await asked).accept();
  await canvas.title.waitFor();
  await canvas.selectTab('Run');
  await expect(canvas.page.getByText('No run yet.')).toBeVisible();

  // Nothing reads the run of the workflow that was left: the wait for such a
  // read runs out, where a follower still on it would read within a second.
  await expect(
    canvas.page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `/api/runs/${RUN_ID}/events`,
      { timeout: 1500 },
    ),
  ).rejects.toThrow();
  await expect(canvas.goal).toBeEditable();
});

test('carries a run reloaded part-way through to its end', async ({
  canvas,
}) => {
  await answerRunWith(canvas.page, [running(1, 'draft')], [runRow('running')], {
    finished: false,
  });
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText('draft');
  await canvas.page.reload();
  await canvas.title.waitFor();
  await canvas.selectTab('Run');
  await expect(canvas.page.getByTestId('run-progress')).toContainText('draft');

  // The run ends while the reloaded page follows it.
  await answerRunWith(canvas.page, RUN_EVENTS);

  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
  await expect(canvas.page.getByText('No run yet.')).toBeHidden();
  await expect(canvas.goal).toHaveValue('Add a greeting to the README');
  await expect(canvas.runButton).toBeEnabled();
});

// The page once drew these views only for `?ui=next`, and the one before
// them for `?ui=classic`. The query is gone; a link that still carries one
// opens the page all the same.
for (const query of ['ui=next', 'ui=classic']) {
  test(`opens the two views for an address with ?${query}`, async ({
    page,
  }) => {
    await page.route('**/api/session', (route) =>
      route.fulfill({ json: sharedSession() }),
    );
    const canvas = new WorkflowCanvasPage(page);

    await page.goto(`/?${query}#${STUB_LAUNCH_CODE}`);
    await canvas.title.waitFor();

    await canvas.expectWorkflowDrawn();
    await expect(page.getByTestId('yaml-text')).toBeVisible();
  });
}

test('has no accessibility violations on either view', async ({ canvas }) => {
  await expectNoAccessibilityViolations(canvas.page);

  await canvas.selectTab('Run');

  await expectNoAccessibilityViolations(canvas.page);
});

test('draws both views in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();

  await expect(stopMark(canvas)).toBeVisible();

  await canvas.selectTab('Run');

  await expect(canvas.runButton).toBeVisible();
});

// Saving the prompt is covered by e2e/editing, where the specs that write to
// the stub run one at a time; this one only types.
test('types a prompt into the keys of a stage', async ({ canvas }) => {
  const properties = canvas.page.getByRole('tabpanel', { name: 'Properties' });
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  const prompt = properties.getByLabel('prompt', { exact: true });

  await expect(prompt).toBeEditable();
  await prompt.fill('Write a warmer greeting to README.md.');

  await expect(canvas.page.getByTestId('save-status')).toContainText(
    'Unsaved changes',
  );
});

const TRUST_FIX =
  'Run `konductor flow trust hello` in a terminal, then try again.';
const TRUST_COMMAND = 'konductor flow trust hello';

// Refuses the start with `trust_required` and its fix, as the server does for
// a workflow nobody has trusted yet, and opens the dialog from the Run view.
async function refuseForTrust(canvas: WorkflowCanvasPage): Promise<void> {
  await refuseRunsWith(canvas.page, 409, {
    error: 'The workflow is not trusted yet.',
    code: 'trust_required',
    fix: TRUST_FIX,
  });
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await canvas.page.getByTestId('trust-command').waitFor();
}

test('opens the trust dialog when the run needs trust', async ({ canvas }) => {
  await refuseForTrust(canvas);
  const dialog = canvas.page.getByTestId('trust-dialog');

  await expect(dialog).toContainText('Trust the workflow to run it');
  await expect(canvas.page.getByTestId('trust-command')).toHaveText(
    TRUST_COMMAND,
  );
  await expect(dialog.getByRole('button', { name: 'Run again' })).toBeVisible();
});

test('copies the command that trusts the workflow', async ({ canvas }) => {
  await canvas.page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write']);
  await refuseForTrust(canvas);

  await canvas.page.getByRole('button', { name: 'Copy command' }).click();

  const copied = await canvas.page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copied).toBe(TRUST_COMMAND);
});

test('starts the run once more with Run again', async ({ canvas }) => {
  await refuseForTrust(canvas);
  await answerRunWith(canvas.page, RUN_EVENTS);

  await canvas.page.getByRole('button', { name: 'Run again' }).click();

  await expect(canvas.page.getByTestId('trust-dialog')).toBeHidden();
  await expect(canvas.page.getByTestId('run-progress')).toContainText(
    'Run passed.',
  );
});

test('leaves the Run view as it was when the dialog is closed', async ({
  canvas,
}) => {
  await refuseForTrust(canvas);

  await canvas.page.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(canvas.page.getByTestId('trust-dialog')).toBeHidden();
  const alert = canvas.page.getByTestId('run-start-error');
  await expect(alert).toContainText('The run did not start.');
  await expect(alert).toContainText(TRUST_COMMAND);
  await expect(canvas.goal).toHaveValue('Add a greeting to the README');
  await expect(canvas.runButton).toBeEnabled();
});

test('has no accessibility violations with the trust dialog open', async ({
  canvas,
}) => {
  await refuseForTrust(canvas);

  await expectNoAccessibilityViolations(canvas.page);
});
