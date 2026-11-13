// SPDX-License-Identifier: Apache-2.0
import type { Page, Route } from '@playwright/test';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';
import { HELLO_PLAN_TEXT } from '../support/hello-plan';
import { STEP_TIMEOUT_MS } from '../support/workflow-canvas-page';
import {
  currentWorkflow,
  overwriteWorkflow,
  SAMPLE_TEXT,
} from '../support/stub-workflow';

// Everything in the sample file above its stages, which a save of the stages
// leaves as it is.
const HEADER = SAMPLE_TEXT.slice(0, SAMPLE_TEXT.indexOf('stages:\n'));

// These tests save to the stub, which keeps one workflow for all of them, so
// they run one after the other in one worker. The `sample` fixture fails a
// test that finds itself in another worker, so `--repeat-each` or a second
// spec file needs `--workers=1`.

test('shows the first stage in Properties and says it is selected', async ({
  designer,
}) => {
  await expect(designer.selected).toContainText('draft');
  await expect(designer.name).toHaveValue('draft');
  await expect(designer.agent).toContainText('k-developer');
  await expect(
    designer.page.getByRole('group', { name: /^Stage draft.*selected$/ }),
  ).toBeVisible();
  await designer.expectStatus('No changes');
  await designer.expectSaveEnabled(false);
});

test('changes the agent of a stage, saves it, and shows it after a reload', async ({
  canvas,
  designer,
  request,
}) => {
  await designer.chooseAgent('k-architect');

  await expect(designer.stage('draft')).toContainText('k-architect · kiro-cli');
  await designer.expectStatus('Unsaved changes');
  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.expectSaveEnabled(false);

  const saved = await currentWorkflow(request);
  expect(saved.text).toBe(SAMPLE_TEXT.replace('k-developer', 'k-architect'));
  await canvas.page.reload();
  await canvas.title.waitFor();
  await expect(canvas.node('node-stage-draft')).toContainText('k-architect');
});

test('changes the agent of a stage of hello-plan and keeps every other key of the file', async ({
  canvas,
  designer,
  request,
}) => {
  await overwriteWorkflow(request, HELLO_PLAN_TEXT);
  await canvas.page.reload();
  await expect(designer.name).toHaveValue('plan');

  await designer.chooseAgent('k-tpm');
  await designer.save.click();
  await designer.expectStatus('Saved');

  expect((await currentWorkflow(request)).text).toBe(
    HELLO_PLAN_TEXT.replace('agent: k-architect', 'agent: k-tpm'),
  );
});

test('keeps Save off for a change it cannot write in place, and says why', async ({
  canvas,
  designer,
  request,
}) => {
  const flow = SAMPLE_TEXT.replace(
    /stages:\n[\s\S]*$/,
    'stages: [{name: draft, agent: k-developer}, {name: review, agent: k-quality-assurance}]\n',
  );
  await overwriteWorkflow(request, flow);
  await canvas.page.reload();
  let puts = 0;
  designer.page.on('request', (sent) => {
    if (sent.method() === 'PUT') puts += 1;
  });

  await expect(designer.page.getByTestId('in-place-notice')).toContainText(
    'cannot change them in place',
  );
  await designer.rename('write');

  await designer.expectStatus('Unsaved changes');
  await designer.expectSaveEnabled(false);
  await designer.save.focus();
  await designer.page.keyboard.press('Enter');
  await expect(designer.save).toBeFocused();
  expect(puts).toBe(0);
  expect((await currentWorkflow(request)).text).toBe(flow);
});

test('opens the trust dialog when a Run after a save answers trust_required', async ({
  canvas,
  designer,
}) => {
  let runs = 0;
  designer.page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url().endsWith('/api/run')) runs += 1;
  });
  await designer.chooseAgent('k-architect');
  await designer.save.click();
  await designer.expectStatus('Saved');
  await canvas.selectTab('Execution');

  await canvas.runButton.click();

  const dialog = canvas.page.getByRole('dialog');
  await expect(dialog).toContainText('Trust the workflow to run it');
  await expect(canvas.page.getByTestId('trust-fix')).toHaveText(
    'Run konductor flow trust hello in a terminal, then try again.',
  );
  await expect(canvas.page.getByTestId('trust-command')).toHaveText(
    'konductor flow trust hello',
  );
  // Chromium lets the page write to and read the clipboard once it is granted.
  await canvas.page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write']);
  await dialog.getByRole('button', { name: 'Copy command' }).click();
  await expect(dialog.getByText('Command copied')).toBeVisible();
  expect(await canvas.page.evaluate(() => navigator.clipboard.readText())).toBe(
    'konductor flow trust hello',
  );

  await dialog.getByRole('button', { name: 'Run again' }).click();

  // The file still differs from the trusted bytes, so the stub refuses again.
  await expect(dialog).toContainText('Trust the workflow to run it');
  expect(runs).toBe(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(canvas.runError).toContainText('The run did not start');
});

test('runs the sample to a pass on the stub when the file holds its trusted bytes', async ({
  canvas,
}) => {
  await canvas.selectTab('Execution');

  await canvas.runButton.click();

  await expect(canvas.badge('node-end')).toHaveText('Passed', {
    timeout: 3 * STEP_TIMEOUT_MS,
  });
  await expect(canvas.page.getByRole('dialog')).toHaveCount(0);
  await expect(canvas.runError).toHaveCount(0);
});

test('renames a stage and saves it', async ({ designer, request }) => {
  await designer.rename('write');

  await expect(designer.stage('write')).toBeVisible();
  await expect(designer.stage('draft')).toHaveCount(0);
  await designer.save.click();
  await designer.expectStatus('Saved');

  expect((await currentWorkflow(request)).text).toBe(
    SAMPLE_TEXT.replace('name: draft', 'name: write'),
  );
});

test('adds an agent stage, which is selected with focus in its name', async ({
  designer,
  request,
}) => {
  await designer.add.click();

  await expect(designer.stage('agent-1')).toContainText('k-developer');
  await expect(designer.name).toHaveValue('agent-1');
  await expect(designer.name).toBeFocused();
  await designer.rename('ship');
  await designer.save.click();
  await designer.expectStatus('Saved');

  expect((await currentWorkflow(request)).text).toBe(
    `${SAMPLE_TEXT}  - name: ship\n    agent: k-developer\n`,
  );
});

test('deletes a stage and saves what is left', async ({
  designer,
  request,
}) => {
  await designer.stage('review').click();
  await expect(designer.name).toHaveValue('review');
  await expect(designer.name).toBeFocused();

  await designer.remove.click();

  await expect(designer.stage('review')).toHaveCount(0);
  await expect(designer.name).toHaveValue('draft');
  await expect(designer.name).toBeFocused();
  await expect(designer.remove).toBeDisabled();
  await designer.save.click();
  await designer.expectStatus('Saved');
  expect((await currentWorkflow(request)).text).toBe(
    `${HEADER}stages:\n  - name: draft\n    agent: k-developer\n`,
  );
});

test('deletes a stage in the middle, selects the one before it and saves the rest in order', async ({
  designer,
  request,
}) => {
  await designer.add.click();
  await designer.rename('ship');
  await designer.stage('review').click();
  await expect(designer.name).toHaveValue('review');

  await designer.remove.click();

  await expect(designer.stage('review')).toHaveCount(0);
  await expect(designer.name).toHaveValue('draft');
  await designer.save.click();
  await designer.expectStatus('Saved');
  expect((await currentWorkflow(request)).text).toBe(
    `${HEADER}stages:\n  - name: draft\n    agent: k-developer\n  - name: ship\n    agent: k-developer\n`,
  );
});

test('does everything with the keyboard', async ({ designer, request }) => {
  const { page } = designer;
  // Add a stage from the button.
  await designer.add.focus();
  await page.keyboard.press('Enter');
  await expect(designer.name).toBeFocused();
  // Rename it where focus landed.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('ship');
  await expect(designer.stage('ship')).toBeVisible();
  // Pick another agent from the list.
  await page.keyboard.press('Tab');
  await expect(designer.agent).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(designer.agent).not.toContainText('k-developer');
  // Choose a stage by its node, then delete it.
  const review = designer.stage('review');
  await review.locator('xpath=ancestor::*[@role="group"][1]').focus();
  await page.keyboard.press('Enter');
  await expect(designer.name).toHaveValue('review');
  await expect(designer.name).toBeFocused();
  await designer.remove.focus();
  await page.keyboard.press('Enter');
  await expect(designer.stage('review')).toHaveCount(0);
  await expect(designer.name).toBeFocused();
  // Save with the keyboard; focus stays on Save.
  await designer.save.focus();
  await page.keyboard.press('Enter');
  await designer.expectStatus('Saved');
  await expect(designer.save).toBeFocused();
  expect((await currentWorkflow(request)).text).toBe(
    `${HEADER}stages:\n  - name: draft\n    agent: k-developer\n  - name: ship\n    agent: k-media-analyzer\n`,
  );
});

test('shows a name the server refuses under the field, and keeps Save off', async ({
  designer,
}) => {
  await designer.stage('review').click();
  await designer.rename('draft');

  await expect(designer.problems).toContainText(
    'The stage name draft is already used.',
  );
  await expect(designer.problems).not.toContainText('`');
  await expect(designer.name).toHaveAttribute('aria-invalid', 'true');
  await expect(designer.page.getByText('Needs a fix')).toBeVisible();
  await designer.expectSaveEnabled(false);
  await expect(designer.name).toBeFocused();

  await designer.rename('review-2');

  await expect(designer.problems).toHaveCount(0);
  await designer.expectSaveEnabled(true);
});

test("shows a name that is not a name, with the server's words, and keeps Save off", async ({
  designer,
}) => {
  await designer.rename('Not A Name');

  await expect(designer.problems).toContainText('must be lower-case letters');
  await expect(designer.name).toHaveAttribute('aria-invalid', 'true');
  await expect(designer.page.getByText('Needs a fix')).toBeVisible();
  await designer.expectSaveEnabled(false);
});

test('tells the person when the file changed, and loads it again', async ({
  canvas,
  designer,
  request,
}) => {
  await designer.rename('write');
  await overwriteWorkflow(
    request,
    SAMPLE_TEXT.replace('k-quality-assurance', 'k-tpm'),
  );

  await designer.save.click();

  await expect(designer.conflict).toContainText('The file changed on disk');
  await expect(designer.save).toBeFocused();
  await designer.expectSaveEnabled(false);
  // Nothing of the draft was written: the file is the one the other writer left.
  expect((await currentWorkflow(request)).text).toBe(
    SAMPLE_TEXT.replace('k-quality-assurance', 'k-tpm'),
  );

  await designer.conflict
    .getByRole('button', { name: 'Load the file again' })
    .click();

  await expect(designer.conflict).toHaveCount(0);
  await expect(canvas.node('node-stage-review')).toContainText('k-tpm');
  await expect(designer.stage('write')).toHaveCount(0);
  await designer.expectStatus('Loaded again from the server');
  await expect(designer.name).toBeFocused();
});

test('lets the person take the draft away on a conflict, before it is replaced', async ({
  designer,
  request,
}) => {
  await designer.rename('write');
  await overwriteWorkflow(request, SAMPLE_TEXT.replace('k-developer', 'k-tpm'));
  await designer.save.click();
  await expect(designer.conflict).toBeVisible();

  await designer.conflict
    .getByRole('button', { name: 'Copy my version' })
    .click();

  const clipboardDenied = designer.page.getByRole('textbox', {
    name: 'My version of the workflow file',
  });
  const copied = designer.conflict.getByText('Copied.');
  await expect(clipboardDenied.or(copied)).toBeVisible();
});

test('keeps the draft when the tab is switched, and tells Execution it is not saved', async ({
  canvas,
  designer,
}) => {
  await designer.rename('write');

  await canvas.selectTab('Execution');

  await expect(canvas.node('node-stage-draft')).toBeVisible();
  await expect(canvas.page.getByTestId('unsaved-note')).toBeVisible();
  await canvas.selectTab('Designer');
  await expect(designer.name).toHaveValue('write');
});

test('draws the saved stages on Execution after a save', async ({
  canvas,
  designer,
}) => {
  await designer.rename('write');
  await designer.save.click();
  await designer.expectStatus('Saved');

  await canvas.selectTab('Execution');

  await expect(designer.stage('write')).toBeVisible();
  await expect(canvas.page.getByTestId('unsaved-note')).toHaveCount(0);
});

test('Designer tab has no axe violations while editing', async ({
  designer,
}) => {
  await designer.rename('write');
  await expectNoAccessibilityViolations(designer.page);
});

test('Designer tab has no axe violations with problems shown', async ({
  designer,
}) => {
  await designer.stage('review').click();
  await designer.rename('draft');
  await expect(designer.problems).toBeVisible();

  await expectNoAccessibilityViolations(designer.page);
});

test('Designer tab has no axe violations with a conflict shown', async ({
  designer,
  request,
}) => {
  await designer.rename('write');
  await overwriteWorkflow(request, SAMPLE_TEXT.replace('k-developer', 'k-tpm'));
  await designer.save.click();
  await expect(designer.conflict).toBeVisible();

  await expectNoAccessibilityViolations(designer.page);
});

test('Designer tab has no axe violations in the dark mode while editing', async ({
  canvas,
  designer,
}) => {
  await canvas.switchTheme();
  await designer.rename('write');

  await expectNoAccessibilityViolations(designer.page);
});

/**
 * Takes over the saves of the page: `answer` decides what each one gets.
 * Returns how many saves the page sent, so a test can say that a save was
 * sent once, and not again.
 */
async function interceptSaves(
  page: Page,
  answer: (route: Route) => Promise<void>,
): Promise<{ sent: () => number }> {
  let sent = 0;
  await page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    sent += 1;
    await answer(route);
  });
  return { sent: () => sent };
}

/** The server answers a save in a way it never does by itself. */
function answerSaveWith(
  page: Page,
  reply: { status: number; body: string; contentType?: string },
) {
  return interceptSaves(page, (route) =>
    route.fulfill({
      status: reply.status,
      contentType: reply.contentType ?? 'application/json',
      body: reply.body,
    }),
  );
}

// A finding as the contract has it: every field of `Diagnostic` is there.
const DUPLICATE_STAGE = {
  code: 'DUPLICATE_STAGE',
  severity: 'error',
  file: 'hello.yml',
  path: 'stages[0].name',
  line: 4,
  column: 11,
  end_line: 4,
  end_column: 16,
  message: 'The stage name `write` is already used.',
};

test('shows the findings of a save the server refuses, and sends the save once', async ({
  designer,
}) => {
  const saves = await answerSaveWith(designer.page, {
    status: 422,
    body: JSON.stringify({
      error: 'The workflow has errors.',
      code: 'invalid_workflow',
      diagnostics: [DUPLICATE_STAGE],
    }),
  });
  await designer.rename('write');

  await designer.save.click();

  await expect(designer.problems).toContainText('is already used');
  await designer.expectStatus('Unsaved changes');
  expect(saves.sent()).toBe(1);
});

test('says so when a save is refused and the server shows nothing to fix', async ({
  designer,
}) => {
  const saves = await answerSaveWith(designer.page, {
    status: 422,
    body: JSON.stringify({
      error: 'The workflow has errors.',
      code: 'invalid_workflow',
    }),
  });
  await designer.rename('write');

  await designer.save.click();

  const alert = designer.alerts;
  await expect(alert).toContainText('The workflow was not saved');
  await expect(alert).toContainText('The workflow has errors.');
  expect(saves.sent()).toBe(1);
});

test('warns that the draft is lost when the session is gone at a save', async ({
  designer,
}) => {
  const saves = await answerSaveWith(designer.page, {
    status: 401,
    body: JSON.stringify({
      error: 'The session is not valid.',
      code: 'unauthorized',
    }),
  });
  await designer.rename('write');

  await designer.save.click();

  const alert = designer.alerts;
  await expect(alert).toContainText('The server no longer knows this session.');
  await expect(alert).toContainText('lost when you open a fresh address');
  await expect(designer.name).toHaveValue('write');
  expect(saves.sent()).toBe(1);
  expect(await designer.page.evaluate(() => window.sessionStorage.length)).toBe(
    0,
  );
});

test('counts a save as done when the answer is lost but the file holds the text', async ({
  designer,
  request,
}) => {
  // The write lands, then the answer is lost.
  const saves = await interceptSaves(designer.page, async (route) => {
    await route.fetch();
    await route.abort('connectionreset');
  });
  await designer.rename('write');

  await designer.save.click();

  await designer.expectStatus('Saved');
  expect(saves.sent()).toBe(1);
  expect((await currentWorkflow(request)).text).toBe(
    SAMPLE_TEXT.replace('name: draft', 'name: write'),
  );
});

test('counts a save as done when the 200 cannot be read but the file holds the text', async ({
  designer,
  request,
}) => {
  const saves = await interceptSaves(designer.page, async (route) => {
    await route.fetch();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await designer.rename('write');

  await designer.save.click();

  await designer.expectStatus('Saved');
  expect(saves.sent()).toBe(1);
  expect((await currentWorkflow(request)).text).toBe(
    SAMPLE_TEXT.replace('name: draft', 'name: write'),
  );
});

test('says the save failed, and may be tried again, when the answer is lost and nothing was written', async ({
  designer,
}) => {
  // The request is dropped before it reaches the stub, so the file cannot
  // have changed; what can go wrong is a send that is repeated.
  const saves = await interceptSaves(designer.page, (route) =>
    route.abort('connectionreset'),
  );
  await designer.rename('write');

  await designer.save.click();

  await expect(designer.alerts).toContainText('The workflow was not saved');
  await designer.expectStatus('Unsaved changes');
  await designer.expectSaveEnabled(true);
  expect(saves.sent()).toBe(1);
});

test('fits every stage in the graph after stages are added to it', async ({
  designer,
}) => {
  const added = 12;
  for (let n = 0; n < added; n += 1) await designer.add.click();

  const last = designer.stage(`agent-${added}`);
  await expect(last).toBeVisible();
  const area = await designer.graph.boundingBox();
  for (const node of [last, designer.stage('draft')]) {
    const box = await node.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(area?.y ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      (area?.y ?? 0) + (area?.height ?? 0),
    );
  }
});
