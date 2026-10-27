// SPDX-License-Identifier: Apache-2.0
import type { Locator } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import {
  NODE_IDS,
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

test('draws a tab under every node but the end and a notch in every node but the intent', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();

  for (const id of NODE_IDS) {
    await expect(canvas.outPort(id)).toHaveCount(id === 'node-end' ? 0 : 1);
    await expect(canvas.inPort(id)).toHaveCount(id === 'node-intent' ? 0 : 1);
  }
});

test('puts each tab in the middle of its card, over the notch of the card under it', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();

  for (let i = 0; i < NODE_IDS.length - 1; i += 1) {
    const [tab, notch, card] = [
      await canvas.outPort(NODE_IDS[i]!).boundingBox(),
      await canvas.inPort(NODE_IDS[i + 1]!).boundingBox(),
      await canvas.node(NODE_IDS[i]!).boundingBox(),
    ];
    const centre = (box: typeof tab) => (box?.x ?? 0) + (box?.width ?? 0) / 2;

    expect(Math.abs(centre(tab) - centre(notch))).toBeLessThan(1);
    expect(Math.abs(centre(tab) - centre(card))).toBeLessThan(1);
    // The tab hangs below the card, and the notch is the same size.
    expect((tab?.y ?? 0) + (tab?.height ?? 0)).toBeGreaterThan(
      (card?.y ?? 0) + (card?.height ?? 0),
    );
    expect(Math.abs((tab?.width ?? 0) - (notch?.width ?? 0))).toBeLessThan(1);
    expect(Math.abs((tab?.height ?? 0) - (notch?.height ?? 0))).toBeLessThan(1);
  }
});

test('starts each link at the tip of a tab and ends it at the top of a notch', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  const links = canvas.edges.locator('.react-flow__edge-path');
  // The boxes of a port and of a link include the dark rim, the width of the
  // line and the arrowhead, which add up to a few pixels.
  const REACH = 4;

  for (let i = 0; i < NODE_IDS.length - 1; i += 1) {
    const [tab, notch, link] = [
      await canvas.outPort(NODE_IDS[i]!).boundingBox(),
      await canvas.inPort(NODE_IDS[i + 1]!).boundingBox(),
      await links.nth(i).boundingBox(),
    ];
    const centre = (box: typeof tab) => (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const bottom = (box: typeof tab) => (box?.y ?? 0) + (box?.height ?? 0);

    expect(Math.abs(centre(link) - centre(tab))).toBeLessThan(1);
    expect(Math.abs((link?.y ?? 0) - bottom(tab))).toBeLessThan(REACH);
    expect(Math.abs(bottom(link) - (notch?.y ?? 0))).toBeLessThan(REACH + 4);
  }
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
    await expect(node.locator('.wf-focus-ring')).toBeVisible();
  }
});

test('draws the focus ring around the tab, not across it', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  await canvas.tab('Designer').focus();

  await canvas.tabToNextNode();
  const focused = canvas.page.locator('.react-flow__node:focus');
  const [ring, tab] = [
    await focused.locator('.wf-focus-ring-port').boundingBox(),
    await focused.locator('.wf-port-tab').boundingBox(),
  ];

  await expect(focused).toHaveCSS('outline-style', 'none');
  // The ring reaches past the tip of the tab, so no part of it is a line
  // across the tab.
  expect((ring?.y ?? 0) + (ring?.height ?? 0)).toBeGreaterThan(
    (tab?.y ?? 0) + (tab?.height ?? 0),
  );
  expect(ring?.width ?? 0).toBeGreaterThan(tab?.width ?? 0);
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
