// SPDX-License-Identifier: Apache-2.0
import type { Locator } from '@playwright/test';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';

async function describedText(input: Locator): Promise<string> {
  return input.evaluate((element) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' '),
  );
}

test('adds, validates, saves, reloads and removes a stage output', async ({
  designer,
}) => {
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await expect(panel.getByText('Outputs')).toBeVisible();
  await panel.getByRole('button', { name: 'Add output' }).click();
  const name = panel.getByRole('textbox', { name: 'Output name 1' });
  await expect(name).toBeFocused();
  await name.fill('Bad_Name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const live = designer.page.getByTestId('designer-live');
  await expect(live).toContainText('An output name must start');
  expect(
    ((await live.textContent()) ?? '').match(/An output name must start/g) ??
      [],
  ).toHaveLength(1);
  await name.fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');

  await panel.getByRole('button', { name: 'Add output' }).click();
  const secondName = panel.getByRole('textbox', { name: 'Output name 2' });
  const secondPath = panel.getByRole('textbox', { name: 'Output path 2' });
  await expect(secondName).toBeFocused();
  await secondName.fill('design');
  await secondPath.fill('NOTES.md');
  await expect(secondName).toHaveAttribute('aria-invalid', 'true');
  expect(await describedText(secondName)).toContain(
    'Output names must be unique in a stage.',
  );
  await expect(live).toContainText('Output names must be unique in a stage.');
  await expect(designer.page.getByTestId('save-refused')).toHaveCount(0);

  await secondName.fill('notes');
  await secondPath.fill('../outside');
  await expect(secondPath).toHaveAttribute('aria-invalid', 'true');
  expect(await describedText(secondPath)).toContain('Use a relative path');
  await expect(live).toContainText('Use a relative path');
  await secondPath.fill('NOTES.md');
  await panel.getByRole('button', { name: 'Remove output' }).nth(1).click();
  await expect(name).toBeFocused();

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
  await expect(
    designer.page.getByRole('button', { name: 'Add output' }),
  ).toBeFocused();
  await designer.expectSaveEnabled(true);
  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).not.toHaveValue(
    /design: DESIGN.md/,
  );
});

test('shows a bad output reference on the stage card and accessible name', async ({
  designer,
}) => {
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add output' }).click();
  await panel.getByRole('textbox', { name: 'Output name 1' }).fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');
  await designer.stage('review').click();
  await designer.prompt.fill('Read {draft.missing}.');

  await expect(
    designer.stage('review').getByText(/names an output.*does not declare/),
  ).toBeVisible();
  await expect(
    designer.page.getByRole('group', {
      name: /Stage review.*problem:.*names an output.*does not declare/,
    }),
  ).toBeVisible();
});
