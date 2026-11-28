// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';

test('edits intent checks and a stage done_when', async ({ designer }) => {
  await designer.page
    .getByRole('button', { name: /checks 1, edit acceptance checks/ })
    .click();
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add check' }).click();
  await panel.getByRole('textbox', { name: 'Check id 2' }).fill('tests-pass');
  await panel.getByRole('button', { name: 'Check kind 2' }).click();
  await designer.page.getByRole('option', { name: 'run' }).click();
  await panel
    .getByRole('textbox', { name: 'run', exact: true })
    .fill('npm\ntest');
  await expectNoAccessibilityViolations(designer.page);

  await designer.page.getByTestId('node-stage-review').click();
  await designer.page.getByTestId('node-stage-draft').click();
  await panel.getByRole('button', { name: 'done_when' }).click();
  await designer.page.getByRole('option', { name: 'tests-pass' }).click();
  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /- id: tests-pass\n      run: \[npm, test\]/,
  );
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /done_when: \[tests-pass\]/,
  );
  await designer.page.reload();
  await expect(
    designer.page.getByRole('button', {
      name: /checks 2, edit acceptance checks/,
    }),
  ).toBeVisible();
});
