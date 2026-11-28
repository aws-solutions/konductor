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

test('validates, edits and cascades intent checks and done_when', async ({
  designer,
}) => {
  await designer.page
    .getByRole('button', { name: /checks 1, edit acceptance checks/ })
    .click();
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add check' }).click();
  const id = panel.getByRole('textbox', { name: 'Check id 2' });
  await expect(id).toBeFocused();
  await id.fill('Bad Id');
  await expect(id).toHaveAttribute('aria-invalid', 'true');
  expect(await describedText(id)).toContain('A check id must start');
  const live = designer.page.getByTestId('designer-live');
  await expect(live).toContainText('A check id must start');
  await id.fill('readme-exists');
  await expect(live).toContainText('Check ids must be unique.');
  await expect(designer.page.getByTestId('save-refused')).toHaveCount(0);
  await id.fill('tests-pass');

  await panel.getByRole('button', { name: 'Check kind 2' }).click();
  await designer.page.getByRole('option', { name: 'run' }).click();
  const run = panel.getByRole('textbox', { name: 'run', exact: true });
  await expect(run).toHaveAttribute('aria-invalid', 'true');
  expect(await describedText(run)).toContain('needs at least one argument');
  await run.fill('npm\ntest');
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();
  await expectNoAccessibilityViolations(designer.page);

  await designer.stage('review').click();
  await designer.stage('draft').click();
  await panel.getByRole('button', { name: 'done_when' }).click();
  await designer.page.getByRole('option', { name: 'tests-pass' }).click();
  await designer.page
    .getByRole('button', { name: /checks 2, edit acceptance checks/ })
    .click();
  await id.fill('verification-pass');
  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /- id: verification-pass\n      run: \[npm, test\]/,
  );
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /done_when: \[verification-pass\]/,
  );

  await designer.page.reload();
  await designer.page
    .getByRole('button', { name: /checks 2, edit acceptance checks/ })
    .click();
  await panel.getByRole('button', { name: 'Remove check' }).nth(1).click();
  await expect(
    panel.getByRole('textbox', { name: 'Check id 1' }),
  ).toBeFocused();
  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).not.toHaveValue(
    /verification-pass/,
  );
});

test('disables check and done_when controls while raw YAML is pending', async ({
  designer,
}) => {
  await designer.openYaml();
  const yaml = designer.page.getByTestId('yaml-text');
  await yaml.fill(`${await yaml.inputValue()}# pending\n`);
  await designer.page
    .getByRole('button', { name: /checks 1, edit acceptance checks/ })
    .click();
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  const id = panel.getByRole('textbox', { name: 'Check id 1' });
  await expect(id).toBeDisabled();
  await expect(id).toHaveValue('readme-exists');
  await expect(panel.getByRole('button', { name: 'Add check' })).toBeDisabled();

  await designer.stage('review').click();
  await designer.stage('draft').click();
  await expect(panel.getByRole('button', { name: 'done_when' })).toBeDisabled();
});
