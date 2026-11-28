// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';

test('adds, edits, saves, reloads and removes a stage output', async ({
  designer,
}) => {
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add output' }).click();
  const name = panel.getByRole('textbox', { name: 'Output name 1' });
  await name.fill('Bad_Name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const live =
    (await designer.page.getByTestId('designer-live').textContent()) ?? '';
  expect(live.match(/An output name must start/g) ?? []).toHaveLength(1);
  await name.fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();
  await expectNoAccessibilityViolations(designer.page);

  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /outputs:\n      design: DESIGN.md/,
  );
  await designer.page.reload();
  await designer.page.getByRole('tab', { name: 'Properties' }).click();
  await expect(
    designer.page.getByRole('textbox', { name: 'Output path 1' }),
  ).toHaveValue('DESIGN.md');

  await designer.page.getByRole('button', { name: 'Remove output' }).click();
  await designer.expectSaveEnabled(true);
  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).not.toHaveValue(
    /design: DESIGN.md/,
  );
});
