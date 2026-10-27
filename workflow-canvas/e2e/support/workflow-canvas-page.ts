// SPDX-License-Identifier: Apache-2.0
import { expect, type Locator, type Page } from '@playwright/test';

/** Tab labels in display order; also used to look up each tab and its panel. */
export const TAB_NAMES = ['Designer', 'Execution'] as const;
/** The label of one tab. */
export type TabName = (typeof TAB_NAMES)[number];

/** Text each tab shows until it has real content. */
export const PLACEHOLDER_TEXT = 'Nothing here yet.';

/** Page object for the workflow canvas shell: title, landmark and tabs. */
export class WorkflowCanvasPage {
  readonly main: Locator;
  readonly title: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.title = this.main.getByRole('heading', { level: 1 });
  }

  /** Loads the app and waits for the title so tests start on a real page. */
  async open(): Promise<void> {
    await this.page.goto('/');
    await this.title.waitFor();
  }

  tab(name: TabName): Locator {
    return this.page.getByRole('tab', { name });
  }

  tabPanel(name: TabName): Locator {
    return this.page.getByRole('tabpanel', { name });
  }

  async selectTab(name: TabName): Promise<void> {
    await this.tab(name).click();
    await this.tabPanel(name).waitFor();
  }

  /** Asserts `name` is the only selected tab and its panel is showing. */
  async expectTabShown(name: TabName): Promise<void> {
    for (const tabName of TAB_NAMES) {
      await expect(this.tab(tabName)).toHaveAttribute(
        'aria-selected',
        String(tabName === name),
      );
    }
    await expect(this.tabPanel(name)).toContainText(PLACEHOLDER_TEXT);
  }
}
