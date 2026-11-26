// SPDX-License-Identifier: Apache-2.0
import { expect, type Locator, type Page } from '@playwright/test';

/** What the save line says. */
export type SaveStatus =
  | 'No changes'
  | 'Unsaved changes'
  | 'Saving'
  | 'Saved'
  | 'Loaded again from the server';

/** Page object for the editing parts of the Design view. */
export class DesignerPage {
  readonly name: Locator;
  readonly agent: Locator;
  /** The text area of the prompt of the selected stage. */
  readonly prompt: Locator;
  /** The read-only path of the prompt file of the selected stage. */
  readonly promptFile: Locator;
  readonly add: Locator;
  readonly remove: Locator;
  readonly save: Locator;
  readonly saveStatus: Locator;
  readonly conflict: Locator;
  readonly problems: Locator;
  /** The alerts of the view: conflicts, a file loaded again, failed saves. */
  readonly alerts: Locator;
  readonly selected: Locator;
  /** The canvas that draws the stages. */
  readonly graph: Locator;

  /** The sub-tab that shows the keys of the stage that is picked. */
  readonly propertiesTab: Locator;
  /** The sub-tab that shows the text of the workflow. */
  readonly yamlTab: Locator;

  constructor(readonly page: Page) {
    this.propertiesTab = page.getByRole('tab', { name: 'Properties' });
    this.yamlTab = page.getByRole('tab', { name: 'YAML' });
    this.name = page.getByRole('textbox', { name: 'name', exact: true });
    this.agent = page.getByRole('button', { name: /^agent / });
    this.prompt = page.getByRole('textbox', { name: 'prompt', exact: true });
    this.promptFile = page.getByRole('textbox', {
      name: 'prompt_file',
      exact: true,
    });
    this.add = page.getByRole('button', { name: 'Add stage' });
    this.remove = page.getByRole('button', { name: 'Delete stage' });
    this.save = page.getByRole('button', { name: 'Save', exact: true });
    this.saveStatus = page.getByTestId('save-status');
    this.conflict = page.getByTestId('conflict');
    this.problems = page.getByTestId('yaml-problems');
    this.alerts = page.getByTestId('edit-alerts');
    this.selected = page.getByText('Selected:');
    this.graph = page.getByRole('region', { name: 'Workflow graph' });
  }

  /**
   * Opens the Properties sub-tab, where the keys of the picked stage are. The
   * view opens on YAML, so a test that reads or types a key opens this first.
   */
  async openProperties(): Promise<void> {
    await this.propertiesTab.click();
    await expect(this.name).toBeVisible();
  }

  /** Opens the YAML sub-tab, where the text and its problems are. */
  async openYaml(): Promise<void> {
    await this.yamlTab.click();
    await expect(this.page.getByTestId('yaml-text')).toBeVisible();
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
