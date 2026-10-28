// SPDX-License-Identifier: Apache-2.0
import { expect, type Locator, type Page } from '@playwright/test';

/** What the save line says. */
export type SaveStatus =
  | 'No changes'
  | 'Unsaved changes'
  | 'Saving'
  | 'Saved'
  | 'Loaded again from the server';

/** Page object for the editing parts of the Designer tab. */
export class DesignerPage {
  readonly name: Locator;
  readonly agent: Locator;
  readonly add: Locator;
  readonly remove: Locator;
  readonly save: Locator;
  readonly saveStatus: Locator;
  readonly conflict: Locator;
  readonly problems: Locator;
  /** The alert region of the Designer: conflicts, failed saves, problems. */
  readonly alerts: Locator;
  readonly selected: Locator;

  constructor(readonly page: Page) {
    this.name = page.getByRole('textbox', { name: 'name', exact: true });
    this.agent = page.getByRole('button', { name: /^agent / });
    this.add = page.getByRole('button', { name: 'Add stage' });
    this.remove = page.getByRole('button', { name: 'Delete stage' });
    this.save = page.getByRole('button', { name: 'Save', exact: true });
    this.saveStatus = page.getByTestId('save-status');
    this.conflict = page.getByTestId('conflict');
    this.problems = page.getByTestId('problems');
    this.alerts = page
      .getByRole('tabpanel', { name: 'Designer' })
      .getByRole('alert');
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

  async expectStatus(status: SaveStatus): Promise<void> {
    await expect(this.saveStatus).toHaveText(status);
  }

  /** Asserts the save button can be pressed, or cannot. */
  async expectSaveEnabled(enabled: boolean): Promise<void> {
    if (enabled) await expect(this.save).toBeEnabled();
    else await expect(this.save).toBeDisabled();
  }
}
