// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';

test('shows editable stage fields, read-only server fields and editable YAML', async ({
  designer,
}) => {
  const properties = designer.page.getByRole('tabpanel', {
    name: 'Properties',
  });
  await expect(properties.getByText('Stage fields')).toBeVisible();
  await expect(designer.name).toBeEditable();
  await expect(designer.agent).toBeEnabled();
  await expect(designer.prompt).toBeEditable();
  await expect(properties.getByText('Other fields')).toBeVisible();
  await expect(
    properties.getByRole('textbox', { name: 'outcome' }),
  ).toHaveAttribute('readonly');
  await expect(designer.promptFile).toHaveAttribute('readonly');
  await expect(designer.remove).toBeVisible();
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();
  await expectNoAccessibilityViolations(designer.page);

  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toBeEditable();
});
