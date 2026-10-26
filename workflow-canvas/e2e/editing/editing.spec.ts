// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';
import {
  currentWorkflow,
  overwriteWorkflow,
  SAMPLE_TEXT,
} from '../support/stub-workflow';

// These tests save to the stub, which keeps one workflow for all of them, so
// they live in one file, which Playwright runs in one worker, in order.

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
  // The launch code worked once, so the reload gets the session again from
  // the fixture and the workflow from the stub.
  await canvas.page.goto('/#e2e-launch-code');
  await canvas.title.waitFor();
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
  // Save with the keyboard; focus stays on Save.
  await designer.save.focus();
  await page.keyboard.press('Enter');
  await designer.expectStatus('Saved');
  await expect(designer.save).toBeFocused();
  expect((await currentWorkflow(request)).text).toContain('name: ship');
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

test('shows a name that is not a name', async ({ designer }) => {
  await designer.rename('Not A Name');

  await expect(designer.problems).toBeVisible();
  await expect(designer.name).toHaveAttribute('aria-invalid', 'true');
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
  // Nothing of the draft was written.
  expect((await currentWorkflow(request)).text).toContain('name: draft');

  await designer.conflict.getByRole('button').click();

  await expect(designer.conflict).toHaveCount(0);
  await expect(canvas.node('node-stage-review')).toContainText('k-tpm');
  await expect(designer.stage('write')).toHaveCount(0);
  await designer.expectStatus('Loaded again from the server');
  await expect(designer.name).toBeFocused();
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
