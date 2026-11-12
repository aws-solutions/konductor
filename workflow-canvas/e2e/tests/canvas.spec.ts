// SPDX-License-Identifier: Apache-2.0
import type { Locator } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { expect, test } from '../support/fixtures';
import { sharedSession } from '../support/session';
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

test('puts an out dot on every node but the end and an in dot on every node but the intent', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();

  for (const id of NODE_IDS) {
    await expect(canvas.outPort(id)).toHaveCount(id === 'node-end' ? 0 : 1);
    await expect(canvas.inPort(id)).toHaveCount(id === 'node-intent' ? 0 : 1);
  }
});

test('centres each dot on the edge of its card, in line with the card under it', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  const centre = (box: Box) => box.x + box.width / 2;
  const middle = (box: Box) => box.y + box.height / 2;

  for (let i = 0; i < NODE_IDS.length - 1; i += 1) {
    const out = await boxOf(canvas.outPort(NODE_IDS[i]!));
    const into = await boxOf(canvas.inPort(NODE_IDS[i + 1]!));
    const card = await boxOf(canvas.node(NODE_IDS[i]!));
    const next = await boxOf(canvas.node(NODE_IDS[i + 1]!));

    expect(Math.abs(centre(out) - centre(card))).toBeLessThan(1);
    expect(Math.abs(centre(out) - centre(into))).toBeLessThan(1);
    expect(Math.abs(middle(out) - (card.y + card.height))).toBeLessThan(1);
    expect(Math.abs(middle(into) - next.y)).toBeLessThan(1);
    expect(out.height).toBe(0);
    expect(out.width).toBeLessThanOrEqual(12);
    expect(Math.abs(out.width - into.width)).toBeLessThan(1);
  }
});

test('hides the dots at rest and shows them on hover, focus and select', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  const review = 'node-stage-review';

  // The first stage is selected when the page opens.
  await expect(canvas.outPort('node-stage-draft')).toHaveCSS('opacity', '1');
  await expect(canvas.outPort(review)).toHaveCSS('opacity', '0');
  await expect(canvas.inPort(review)).toHaveCSS('opacity', '0');

  await canvas.node(review).hover();
  await expect(canvas.outPort(review)).toHaveCSS('opacity', '1');
  await expect(canvas.inPort(review)).toHaveCSS('opacity', '1');

  await canvas.page.mouse.move(0, 0);
  await expect(canvas.outPort(review)).toHaveCSS('opacity', '0');
  await canvas.tab('Designer').focus();
  await canvas.tabToNextNode();
  await expect(canvas.outPort('node-intent')).toHaveCSS('opacity', '1');
});

test('starts each link at an out dot and ends it at the next in dot', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  const links = canvas.edges.locator('.react-flow__edge-path');
  // The box of a link includes the width of its line and the arrowhead.
  const REACH = 2;

  for (let i = 0; i < NODE_IDS.length - 1; i += 1) {
    const out = await boxOf(canvas.outPort(NODE_IDS[i]!));
    const into = await boxOf(canvas.inPort(NODE_IDS[i + 1]!));
    const link = await boxOf(links.nth(i));
    const centre = (box: Box) => box.x + box.width / 2;

    expect(Math.abs(centre(link) - centre(out))).toBeLessThan(1);
    expect(Math.abs(link.y - (out.y + out.height))).toBeLessThan(REACH);
    expect(Math.abs(link.y + link.height - into.y)).toBeLessThan(REACH);
  }
});

type Box = { x: number; y: number; width: number; height: number };

// A port handle has no height, so it is measured in the page instead of with
// `boundingBox`, which has no box for it.
async function boxOf(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}

/** A view of a workflow with `count` stages, as `GET /api/workflow` returns it. */
function workflowOf(count: number) {
  const stages = Array.from({ length: count }, (_, i) => ({
    name: `s${i + 1}`,
    agent: 'k-developer',
  }));
  return {
    name: 'big',
    text: 'name: big\n',
    hash: 'a'.repeat(64),
    read_only: false,
    view: { name: 'big', intent: { outcome: 'Run it' }, stages },
    diagnostics: [],
  };
}

/** Asserts that every node of the graph lies inside the canvas. */
async function expectEveryNodeInCanvas(canvas: WorkflowCanvasPage) {
  const area = await canvas.graph.boundingBox();
  for (const node of await canvas.graph.locator('.react-flow__node').all()) {
    const box = await node.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(area?.x ?? 0);
    expect(box?.y).toBeGreaterThanOrEqual(area?.y ?? 0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (area?.x ?? 0) + (area?.width ?? 0),
    );
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      (area?.y ?? 0) + (area?.height ?? 0),
    );
  }
}

test('fits every node of a workflow of 40 stages in the canvas', async ({
  page,
}) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await page.route('**/api/workflow', (route) =>
    route.fulfill({ json: workflowOf(40) }),
  );
  const canvas = new WorkflowCanvasPage(page);
  await canvas.open(STUB_LAUNCH_CODE);

  await expect(canvas.graph.locator('.react-flow__node')).toHaveCount(42);
  await expectEveryNodeInCanvas(canvas);
});

test('fits the nodes of a bigger workflow that replaces the one on the page', async ({
  canvas,
  page,
}) => {
  await canvas.expectWorkflowDrawn();
  await page.route('**/api/workflow', (route) =>
    route.fulfill({ json: workflowOf(40) }),
  );

  await page.evaluate(
    (code) => (window.location.hash = code),
    'q3x7vJ2kLmN9pRs4TuVw5Y_-ab12',
  );

  await expect(canvas.graph.locator('.react-flow__node')).toHaveCount(42);
  await expectEveryNodeInCanvas(canvas);
});

test('shows in full the Japanese text that a node cuts short', async ({
  page,
}) => {
  const outcome = '作'.repeat(60);
  const name = '日本語の長いステージ名です';
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await page.route('**/api/workflow', (route) =>
    route.fulfill({
      json: {
        name: 'jp',
        text: 'name: jp\n',
        hash: 'a'.repeat(64),
        read_only: false,
        view: {
          name: 'jp',
          intent: { outcome },
          stages: [{ name, agent: 'a' }],
        },
        diagnostics: [],
      },
    }),
  );
  const canvas = new WorkflowCanvasPage(page);
  await canvas.open(STUB_LAUNCH_CODE);

  await expect(page.getByTestId('full-intent')).toHaveText(
    `Intent: ${outcome}`,
  );
  await expect(page.getByTestId(`full-stage-${name}`)).toBeVisible();
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
    await expect(node).toHaveAccessibleDescription(/^Workflow graph node\./);
    await expect(node.locator('.wf-focus-ring')).toBeVisible();
  }
});

test('draws the focus ring in the node, in place of the outline of the browser', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  await canvas.tab('Designer').focus();

  await canvas.tabToNextNode();
  const focused = canvas.page.locator('.react-flow__node:focus');
  const ring = focused.locator('.wf-focus-ring');

  await expect(focused).toHaveCSS('outline-style', 'none');
  await expect(ring).toBeVisible();
  // The border is 2 pixels; the ring adds a 2 pixel gap and 3 pixels of ring
  // on each side, so it lies outside the card.
  await expect(ring).toHaveAttribute('stroke-width', '12');
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
  await expect(canvas.runLiveStatus).toHaveText('');
});

test('explains what to do when the address has no launch code', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);

  await canvas.open();

  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await expect(page.getByText(/no launch code in the address/)).toBeVisible();
});
