// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';
import type { DesignerPage } from '../support/designer-page';

const component = (designer: DesignerPage, id: string) =>
  designer.page
    .getByRole('region', { name: 'Components' })
    .getByRole('button', { name: new RegExp(`\\b${id}\\b`) });

test('filters components and adds one from the keyboard', async ({
  designer,
}) => {
  const filter = designer.page.getByRole('searchbox', {
    name: 'Filter components',
  });
  await filter.fill('architect');
  await expect(component(designer, 'k-architect')).toBeVisible();
  await expect(component(designer, 'k-developer')).toHaveCount(0);
  await designer.yamlTab.click();
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();
  await expectNoAccessibilityViolations(designer.page);

  const architect = component(designer, 'k-architect');
  await architect.focus();
  await designer.page.keyboard.press('Enter');

  await expect(designer.stage('agent-1')).toContainText('k-architect');
  await expect(designer.name).toBeFocused();
  await expect(designer.name).toHaveValue('agent-1');
});

test('drags a component between two stages', async ({ designer }) => {
  const review = designer.stage('review');
  await component(designer, 'k-architect').dragTo(review, {
    targetPosition: { x: 100, y: 8 },
  });

  const draftBox = await designer.stage('draft').boundingBox();
  const addedBox = await designer.stage('agent-1').boundingBox();
  const reviewBox = await review.boundingBox();
  expect(addedBox?.y).toBeGreaterThan(draftBox?.y ?? 0);
  expect(addedBox?.y).toBeLessThan(reviewBox?.y ?? Number.MAX_SAFE_INTEGER);
  await expect(designer.stage('agent-1')).toContainText('k-architect');
});

test('drags a component to the end', async ({ designer }) => {
  const graphBox = await designer.graph.boundingBox();
  await component(designer, 'k-tpm').dragTo(designer.graph, {
    targetPosition: {
      x: Math.floor((graphBox?.width ?? 600) / 2),
      y: Math.max(1, Math.floor((graphBox?.height ?? 600) - 10)),
    },
  });

  const reviewBox = await designer.stage('review').boundingBox();
  const addedBox = await designer.stage('agent-1').boundingBox();
  expect(addedBox?.y).toBeGreaterThan(reviewBox?.y ?? 0);
  await expect(designer.stage('agent-1')).toContainText('k-tpm');
});
