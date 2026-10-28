// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';
import {
  currentWorkflow,
  overwriteWorkflow,
  SAMPLE_TEXT,
} from '../support/stub-workflow';

// These tests save to the stub, which keeps one workflow for all of them, so
// they run one after the other in one worker. The `sample` fixture fails a
// test that finds itself in another worker, so `--repeat-each` or a second
// spec file needs `--workers=1`.
test.describe.configure({ mode: 'serial' });

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
  // A reload has no launch code, as the code works once. The person opens the
  // launch address again, and the fixture answers for the session.
  await canvas.page.reload();
  await expect(
    canvas.page.getByText(/no launch code in the address/),
  ).toBeVisible();
  await canvas.open(STUB_LAUNCH_CODE);
  await expect(canvas.node('node-stage-draft')).toContainText('k-architect');
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
    'name: hello\nintent: Add a greeting to the README\nstages:\n  - name: draft\n    agent: k-developer\n',
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
    'name: hello\nintent: Add a greeting to the README\nstages:\n  - name: draft\n    agent: k-developer\n  - name: ship\n    agent: k-developer\n',
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
    'name: hello\nintent: Add a greeting to the README\nstages:\n  - name: draft\n    agent: k-developer\n  - name: ship\n    agent: k-media-analyzer\n',
  );
});

test('shows a name the server refuses under the field, and keeps Save off', async ({
  designer,
}) => {
  await designer.stage('review').click();
  await designer.rename('draft');

  await expect(designer.problems).toContainText(
    'The stage name `draft` is already used.',
  );
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

  await expect(designer.problems).toContainText('Not A Name');
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

// The server is told to answer a save in a way it never does by itself.
async function answerSaveWith(
  designer: { page: Page },
  reply: { status: number; body: string; contentType?: string },
): Promise<void> {
  await designer.page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await route.fulfill({
      status: reply.status,
      contentType: reply.contentType ?? 'application/json',
      body: reply.body,
    });
  });
}

test('shows the findings of a save the server refuses, and writes nothing', async ({
  designer,
  request,
}) => {
  await answerSaveWith(designer, {
    status: 422,
    body: JSON.stringify({
      error: 'The workflow has errors.',
      code: 'invalid_workflow',
      diagnostics: [
        {
          code: 'DUPLICATE_STAGE',
          severity: 'error',
          path: 'stages[0].name',
          line: 4,
          message: 'The stage name `write` is already used.',
        },
      ],
    }),
  });
  await designer.rename('write');

  await designer.save.click();

  await expect(designer.problems).toContainText('is already used');
  await designer.expectStatus('Unsaved changes');
  expect((await currentWorkflow(request)).text).toBe(SAMPLE_TEXT);
});

test('says so when a save is refused and the server shows nothing to fix', async ({
  designer,
  request,
}) => {
  await answerSaveWith(designer, {
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
  expect((await currentWorkflow(request)).text).toBe(SAMPLE_TEXT);
});

test('warns that the draft is lost when the session is gone at a save', async ({
  designer,
}) => {
  await answerSaveWith(designer, {
    status: 401,
    body: JSON.stringify({
      error: 'The session is not valid.',
      code: 'unauthorized',
    }),
  });
  await designer.rename('write');

  await designer.save.click();

  const alert = designer.alerts;
  await expect(alert).toContainText('The session is not valid.');
  await expect(alert).toContainText('lost when you do');
  await expect(designer.name).toHaveValue('write');
});

test('counts a save as done when the answer is lost but the file holds the text', async ({
  designer,
  request,
}) => {
  const page = designer.page;
  await page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    // The write lands, then the answer is lost.
    await route.fetch();
    await route.abort('connectionreset');
  });
  await designer.rename('write');

  await designer.save.click();

  await designer.expectStatus('Saved');
  expect((await currentWorkflow(request)).text).toBe(
    SAMPLE_TEXT.replace('name: draft', 'name: write'),
  );
});

test('counts a save as done when the 200 cannot be read but the file holds the text', async ({
  designer,
  request,
}) => {
  await designer.page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await route.fetch();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await designer.rename('write');

  await designer.save.click();

  await designer.expectStatus('Saved');
  expect((await currentWorkflow(request)).text).toBe(
    SAMPLE_TEXT.replace('name: draft', 'name: write'),
  );
});

test('says the save failed, and may be tried again, when the answer is lost and nothing was written', async ({
  designer,
  request,
}) => {
  await designer.page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await route.abort('connectionreset');
  });
  await designer.rename('write');

  await designer.save.click();

  await expect(designer.alerts).toContainText('The workflow was not saved');
  await designer.expectStatus('Unsaved changes');
  await designer.expectSaveEnabled(true);
  expect((await currentWorkflow(request)).text).toBe(SAMPLE_TEXT);
});
