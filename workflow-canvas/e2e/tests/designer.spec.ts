// SPDX-License-Identifier: Apache-2.0
import type { Locator } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { test as editing, expect } from '../support/editing-fixtures';
import { test as base } from '../support/fixtures';
import { sharedSession } from '../support/session';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

// The stage that is selected when the page opens, named the way a screen
// reader hears it.
const SELECTED_DRAFT = /^Stage draft, .*, selected$/;

editing(
  'moves focus to the name when Enter is pressed on the selected stage',
  async ({ designer }) => {
    const node = designer.page.getByRole('group', { name: SELECTED_DRAFT });
    await node.focus();

    await designer.page.keyboard.press('Enter');

    await expect(designer.name).toBeFocused();
  },
);

editing(
  'moves focus to the name when Space is pressed on the selected stage',
  async ({ designer }) => {
    const node = designer.page.getByRole('group', { name: SELECTED_DRAFT });
    await node.focus();

    await designer.page.keyboard.press('Space');

    await expect(designer.name).toBeFocused();
  },
);

editing(
  'keeps focus on a stage when Escape is pressed on it',
  async ({ designer }) => {
    const node = designer.page.getByRole('group', { name: SELECTED_DRAFT });
    await node.focus();

    await designer.page.keyboard.press('Escape');

    await expect(node).toBeFocused();
  },
);

// The Designer is a grid of the graph and Properties; a note above them takes
// the whole row, so the graph keeps the wide column. Layout is not drawn in
// jsdom, so this needs a browser.
base(
  'keeps the graph wide and beside Properties under the note of a read-only workflow',
  async ({ page }) => {
    await page.route('**/api/session', (route) =>
      route.fulfill({ json: sharedSession() }),
    );
    await page.route('**/api/workflow', async (route) => {
      const response = await route.fetch();
      const document = (await response.json()) as object;
      await route.fulfill({ json: { ...document, read_only: true } });
    });
    const canvas = new WorkflowCanvasPage(page);
    await canvas.open(STUB_LAUNCH_CODE);
    await canvas.expectWorkflowDrawn();

    const boxOf = (locator: Locator) =>
      locator.evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
    const items = page.locator('.wf-designer > *');
    const note = await boxOf(page.getByTestId('read-only-note'));
    const card = await boxOf(
      items.filter({
        has: page.getByRole('region', { name: 'Workflow graph' }),
      }),
    );
    const properties = await boxOf(
      items.filter({ has: page.getByRole('heading', { name: 'Properties' }) }),
    );

    expect(card.width).toBeGreaterThan(properties.width);
    expect(card.x).toBeLessThan(properties.x);
    expect(card.y).toBeGreaterThanOrEqual(note.y + note.height);
    expect(Math.abs(card.y - properties.y)).toBeLessThan(1);
    expect(note.x + note.width).toBeGreaterThanOrEqual(
      properties.x + properties.width - 1,
    );
  },
);
