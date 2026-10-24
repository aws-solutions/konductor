// SPDX-License-Identifier: Apache-2.0
import type { Locator, Page } from '@playwright/test';

export const TAB_NAMES = ['Designer', 'Execution'] as const;
export type TabName = (typeof TAB_NAMES)[number];

/** Page object for the workflow canvas shell: title, landmark and tabs. */
export class WorkflowCanvasPage {
  readonly main: Locator;
  readonly title: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.title = this.main.getByRole('heading', { level: 1 });
  }

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
}
