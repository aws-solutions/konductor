// SPDX-License-Identifier: Apache-2.0
import { AA_TEXT, contrastRatio } from '../../src/theme/contrast';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';

function hexOf(rgb: string): string {
  const channels = rgb.match(/\d+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Bad colour: ${rgb}`);
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

async function expectChipInsideIntent(
  page: Parameters<typeof expectNoAccessibilityViolations>[0],
  count: number,
) {
  const chip = page.getByRole('button', {
    name: `params ${count}, edit declared parameters`,
  });
  const intent = page.getByTestId('node-intent');
  const [chipBox, intentBox] = await Promise.all([
    chip.boundingBox(),
    intent.boundingBox(),
  ]);
  expect(chipBox).not.toBeNull();
  expect(intentBox).not.toBeNull();
  expect(chipBox!.x).toBeGreaterThan(intentBox!.x + intentBox!.width / 2);
  expect(chipBox!.y).toBeGreaterThan(intentBox!.y + intentBox!.height / 2);
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(
    intentBox!.x + intentBox!.width,
  );
  expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(
    intentBox!.y + intentBox!.height,
  );
  const colors = await chip.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      text: style.color,
    };
  });
  expect(
    contrastRatio(hexOf(colors.text), hexOf(colors.background)),
  ).toBeGreaterThanOrEqual(AA_TEXT);
  expect(
    contrastRatio(hexOf(colors.border), hexOf(colors.background)),
  ).toBeGreaterThanOrEqual(AA_TEXT);
}

test('edits, adds, saves and removes workflow parameters', async ({
  designer,
}) => {
  await expectChipInsideIntent(designer.page, 1);
  await designer.page
    .getByRole('button', {
      name: 'params 1, edit declared parameters',
    })
    .click();
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  const names = panel.getByRole('textbox', { name: 'name', exact: true });
  const descriptions = panel.getByRole('textbox', { name: 'description' });
  const defaults = panel.getByRole('textbox', { name: 'default' });
  await expect(names).toHaveCount(1);

  await descriptions.first().fill('Run goal');
  await defaults.first().fill('Ship the change');
  await panel.getByRole('button', { name: 'Add parameter' }).click();
  await expectChipInsideIntent(designer.page, 2);
  await designer.page.getByRole('button', { name: 'Undo' }).click();
  await expectChipInsideIntent(designer.page, 1);
  await designer.page.getByRole('button', { name: 'Redo' }).click();
  await expectChipInsideIntent(designer.page, 2);

  await expect(names).toHaveCount(2);
  await names.nth(1).fill('audience');
  await descriptions.nth(1).fill('Reader');
  await defaults.nth(1).fill('Developers');
  await panel.getByRole('checkbox', { name: 'required' }).nth(1).check();
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();
  await expectChipInsideIntent(designer.page, 2);
  await expectNoAccessibilityViolations(designer.page);

  await designer.save.click();
  await designer.expectStatus('Saved');
  await expectChipInsideIntent(designer.page, 2);
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /audience:\n    description: Reader\n    default: Developers\n    required: true/,
  );

  await designer.propertiesTab.click();
  await panel.getByRole('button', { name: 'Remove parameter' }).nth(1).click();
  await expectChipInsideIntent(designer.page, 1);
  await designer.page.getByRole('button', { name: 'Undo' }).click();
  await expectChipInsideIntent(designer.page, 2);
  await designer.page.getByRole('button', { name: 'Redo' }).click();
  await expectChipInsideIntent(designer.page, 1);
  await designer.save.click();
  await designer.expectStatus('Saved');
  await expectChipInsideIntent(designer.page, 1);
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).not.toHaveValue(
    /audience:/,
  );
});
