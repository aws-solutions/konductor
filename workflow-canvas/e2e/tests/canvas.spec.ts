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

test('fits every node of a workflow of 40 stages in the canvas', async ({
  page,
}) => {
  const stages = Array.from({ length: 40 }, (_, i) => ({
    name: `s${i + 1}`,
    agent: 'k-developer',
  }));
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: sharedSession() }),
  );
  await page.route('**/api/workflow', (route) =>
    route.fulfill({
      json: {
        name: 'big',
        text: 'name: big\n',
        hash: 'a'.repeat(64),
        read_only: false,
        view: { name: 'big', intent: { outcome: 'Run it' }, stages },
        diagnostics: [],
      },
    }),
  );
  const canvas = new WorkflowCanvasPage(page);
  await canvas.open(STUB_LAUNCH_CODE);

  const area = await canvas.graph.boundingBox();
  const nodes = canvas.graph.locator('.react-flow__node');
  await expect(nodes).toHaveCount(42);
  for (const node of await nodes.all()) {
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

test('draws a knob under every node but the end and a socket in every node but the intent', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();

  for (const id of NODE_IDS) {
    await expect(canvas.knob(id)).toHaveCount(id === 'node-end' ? 0 : 1);
    await expect(canvas.socket(id)).toHaveCount(id === 'node-intent' ? 0 : 1);
  }
});

test('lines each knob up with the socket under it and ends the link above the socket', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();
  const links = canvas.edges.locator('.react-flow__edge-path');

  for (let i = 0; i < NODE_IDS.length - 1; i += 1) {
    const [knob, socket, link, card] = [
      await canvas.knob(NODE_IDS[i]!).boundingBox(),
      await canvas.socket(NODE_IDS[i + 1]!).boundingBox(),
      await links.nth(i).boundingBox(),
      await canvas.node(NODE_IDS[i + 1]!).boundingBox(),
    ];
    const centre = (box: typeof knob) => (box?.x ?? 0) + (box?.width ?? 0) / 2;

    expect(Math.abs(centre(knob) - centre(socket))).toBeLessThan(1);
    expect(Math.abs(centre(link) - centre(knob))).toBeLessThan(1);
    // The link starts at the tip of the knob and stops above the card, so the
    // arrowhead never covers the socket.
    expect(
      (link?.y ?? 0) - ((knob?.y ?? 0) + (knob?.height ?? 0)),
    ).toBeLessThan(1);
    expect((link?.y ?? 0) + (link?.height ?? 0)).toBeLessThanOrEqual(
      (card?.y ?? 0) + 0.5,
    );
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
