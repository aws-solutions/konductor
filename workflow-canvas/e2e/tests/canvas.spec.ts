// SPDX-License-Identifier: Apache-2.0
import type { Locator } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import {
  NODE_NAMES,
  WorkflowCanvasPage,
} from '../support/workflow-canvas-page';

/** Where `to` is, relative to `from`, in whole pixels. */
async function offsetBetween(from: Locator, to: Locator) {
  const [a, b] = [await from.boundingBox(), await to.boundingBox()];
  return {
    x: Math.round((b?.x ?? 0) - (a?.x ?? 0)),
    y: Math.round((b?.y ?? 0) - (a?.y ?? 0)),
  };
}

test('draws the workflow of the API on the Designer tab', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  await expect(
    canvas.page.getByRole('heading', { name: 'Workflow: hello' }),
  ).toBeVisible();
});

test('shows the intent, then each stage with its agent and harness, then the end', async ({
  canvas,
}) => {
  await expect(canvas.node('node-intent')).toContainText(
    'Add a greeting to the README',
  );
  await expect(canvas.node('node-stage-draft')).toContainText('draft');
  await expect(canvas.node('node-stage-draft')).toContainText(
    'k-developer · kiro-cli',
  );
  await expect(canvas.node('node-stage-review')).toContainText('review');
  await expect(canvas.node('node-stage-review')).toContainText(
    'k-quality-assurance · kiro-cli',
  );
  await expect(canvas.node('node-end')).toContainText('end');
});

test('stacks the nodes in the order of the stages', async ({ canvas }) => {
  const tops: number[] = [];
  for (const id of [
    'node-intent',
    'node-stage-draft',
    'node-stage-review',
    'node-end',
  ] as const) {
    const box = await canvas.node(id).boundingBox();
    tops.push(box?.y ?? Number.NaN);
  }

  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  expect(new Set(tops).size).toBe(tops.length);
});

test('removes the launch code from the address', async ({ canvas }) => {
  await canvas.expectWorkflowDrawn();

  expect(new URL(canvas.page.url()).hash).toBe('');
});

test('keeps the graph when the tabs are switched', async ({ canvas }) => {
  await canvas.expectWorkflowDrawn();

  await canvas.selectTab('Execution');
  await canvas.selectTab('Designer');

  await canvas.expectWorkflowDrawn();
});

test('does not let a node be dragged', async ({ canvas }) => {
  await canvas.expectWorkflowDrawn();
  const draft = canvas.node('node-stage-draft');
  const gapBefore = await offsetBetween(draft, canvas.node('node-end'));
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
  } = (await draft.boundingBox()) ?? {};
  const { mouse } = canvas.page;

  await mouse.move(x + width / 2, y + height / 2);
  await mouse.down();
  await mouse.move(x + width / 2 + 80, y + height / 2 + 40, { steps: 5 });
  await mouse.up();

  // Dragging the pane pans every node alike; dragging a node would not.
  expect(await offsetBetween(draft, canvas.node('node-end'))).toEqual(
    gapBefore,
  );
});

test('reaches each node with the Tab key and names it', async ({ canvas }) => {
  await canvas.expectWorkflowDrawn();
  await canvas.tab('Designer').focus();

  for (const name of NODE_NAMES) {
    await canvas.tabToNextNode();
    const node = canvas.nodeNamed(name);

    await expect(node).toBeFocused();
    await expect(node).toHaveAccessibleName(name);
    await expect(node).toHaveAccessibleDescription(/^Read-only workflow graph/);
    await expect(node).toHaveCSS('outline-style', 'solid');
    await expect(node).toHaveCSS('outline-width', '3px');
  }
});

test('names the edges by the nodes they join, not by ids', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();

  await expect(canvas.edges.first()).toHaveAttribute(
    'aria-label',
    'Run order from intent to stage draft',
  );
  await expect(canvas.graph.locator('[aria-label*="stage-"]')).toHaveCount(0);
});

test('shows an error when the launch code is wrong', async ({ page }) => {
  const canvas = new WorkflowCanvasPage(page);

  await canvas.open('not-the-launch-code');

  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await expect(page.getByText('The launch code is not valid.')).toBeVisible();
  await expect(canvas.graph).toHaveCount(0);
});

test('explains what to do when the address has no launch code', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);

  await canvas.open();

  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await expect(page.getByText(/no launch code in the address/)).toBeVisible();
});
