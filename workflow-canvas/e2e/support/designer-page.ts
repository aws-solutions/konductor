// SPDX-License-Identifier: Apache-2.0
import type { Locator, Page } from '@playwright/test';

/** Page object for the editing parts of the Designer tab. */
export class DesignerPage {
  readonly name: Locator;
  readonly agent: Locator;
  readonly add: Locator;
  readonly remove: Locator;
  readonly selected: Locator;

  constructor(readonly page: Page) {
    this.name = page.getByRole('textbox', { name: 'name', exact: true });
    this.agent = page.getByRole('button', { name: /^agent / });
    this.add = page.getByRole('button', { name: 'Add stage' });
    this.remove = page.getByRole('button', { name: 'Delete stage' });
    this.selected = page.getByText('Selected:');
  }

  /** The node of the stage with the name. */
  stage(name: string): Locator {
    return this.page.getByTestId(`node-stage-${name}`);
  }

  /** Types the name into the name field, replacing what is there. */
  async rename(name: string): Promise<void> {
    await this.name.fill(name);
  }

  /** Opens the list of agents and picks one. */
  async chooseAgent(id: string): Promise<void> {
    await this.agent.click();
    await this.page
      .getByRole('option', { name: new RegExp(`^${id}\\b`) })
      .click();
  }
}
