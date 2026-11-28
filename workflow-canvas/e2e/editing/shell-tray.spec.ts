// SPDX-License-Identifier: Apache-2.0
import { AGENT_DRAG_TYPE } from '../../src/canvas/agent-drag';
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

test('blocks Add, Enter and drop while a form save is held', async ({
  designer,
}) => {
  let releaseSave = () => {};
  let markStarted = () => {};
  const held = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await designer.page.route('**/api/workflow', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    markStarted();
    await held;
    await route.continue();
  });
  await designer.rename('drafting');
  await designer.save.click();
  await started;
  await designer.expectStatus('Saving');

  try {
    await expect(designer.add).toBeDisabled();
    await designer.add.evaluate((button: HTMLButtonElement) => button.click());
    const architect = component(designer, 'k-architect');
    await expect(architect).toHaveAttribute('aria-disabled', 'true');
    await architect.focus();
    await designer.page.keyboard.press('Enter');
    await designer.graph.evaluate((graph, type) => {
      const transfer = new DataTransfer();
      transfer.setData(type, 'k-architect');
      graph.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          clientY: graph.getBoundingClientRect().bottom - 10,
          dataTransfer: transfer,
        }),
      );
    }, AGENT_DRAG_TYPE);
    await expect(designer.graph.locator('.react-flow__node-stage')).toHaveCount(
      2,
    );
  } finally {
    releaseSave();
  }
  await designer.expectStatus('Saved');
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
