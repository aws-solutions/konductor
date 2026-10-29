// SPDX-License-Identifier: Apache-2.0
import { expect, type Locator, type Page } from '@playwright/test';

/** Tab labels in display order; also used to look up each tab and its panel. */
export const TAB_NAMES = ['Designer', 'Execution'] as const;
/** The label of one tab. */
export type TabName = (typeof TAB_NAMES)[number];

/** The two modes of the page. */
export type ThemeName = 'light' | 'dark';

/** Text the Execution tab shows until it has real content. */
export const PLACEHOLDER_TEXT = 'Nothing here yet.';

/** The nodes of the workflow canvas, top to bottom, by test id. */
export const NODE_IDS = [
  'node-intent',
  'node-stage-draft',
  'node-stage-review',
  'node-end',
] as const;
/** The test id of one node. */
export type NodeId = (typeof NODE_IDS)[number];

/** What a screen reader says for each node, top to bottom. */
export const NODE_NAMES = [
  'Intent: Add a greeting to the README',
  'Stage draft, agent k-developer, harness kiro-cli',
  'Stage review, agent k-quality-assurance, harness kiro-cli',
  'End',
] as const;

/** The most Tab presses between one node and the next one to take focus. */
const MAX_TABS_TO_NEXT_NODE = 10;

/** Page object for the workflow canvas: title, landmark, tabs and the graph. */
export class WorkflowCanvasPage {
  readonly main: Locator;
  readonly title: Locator;
  readonly graph: Locator;
  readonly edges: Locator;
  readonly themeButton: Locator;
  readonly breadcrumbs: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.title = this.main.getByRole('heading', { level: 1 });
    this.graph = page.getByRole('region', { name: 'Workflow graph' });
    this.edges = this.graph.locator('.react-flow__edge');
    this.themeButton = page.getByRole('button', { name: /^Theme:/ });
    this.breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumbs' });
  }

  /**
   * Loads the app, with the launch code in the address as the server prints
   * it when `launchCode` is given, and waits for the title.
   */
  async open(launchCode?: string): Promise<void> {
    await this.page.goto(launchCode ? `/#${launchCode}` : '/');
    await this.title.waitFor();
  }

  /** Presses the theme button and waits until the page is in the other mode. */
  async switchTheme(): Promise<void> {
    const next: ThemeName =
      (await this.themeName()) === 'dark' ? 'light' : 'dark';
    await this.themeButton.click();
    await expect(this.themeButton).toHaveText(`Theme: ${next}`);
  }

  /** The mode the page is in, as the theme button says it. */
  async themeName(): Promise<ThemeName> {
    const text = (await this.themeButton.textContent()) ?? '';
    return text.endsWith('dark') ? 'dark' : 'light';
  }

  tab(name: TabName): Locator {
    return this.page.getByRole('tab', { name });
  }

  tabPanel(name: TabName): Locator {
    return this.page.getByRole('tabpanel', { name });
  }

  node(id: NodeId): Locator {
    return this.graph.getByTestId(id);
  }

  /** The tab under a node, where its run order leaves. */
  outPort(id: NodeId): Locator {
    return this.node(id).locator('.wf-port-tab');
  }

  /** The notch in the top edge of a node, where its run order arrives. */
  inPort(id: NodeId): Locator {
    return this.node(id).locator('.wf-port-notch');
  }

  /** The node that a screen reader names `name`. */
  nodeNamed(name: string): Locator {
    return this.graph.getByRole('group', { name, exact: true });
  }

  /** Presses Tab until a node of the graph has focus. */
  async tabToNextNode(): Promise<void> {
    for (let press = 0; press < MAX_TABS_TO_NEXT_NODE; press += 1) {
      await this.page.keyboard.press('Tab');
      const onNode = await this.page.evaluate(() =>
        document.activeElement?.classList.contains('react-flow__node'),
      );
      if (onNode) return;
    }
    throw new Error('Tab did not reach a node of the graph.');
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
    await expect(this.tabPanel(name)).toBeVisible();
    if (name === 'Execution') {
      await expect(this.tabPanel(name)).toContainText(PLACEHOLDER_TEXT);
    }
  }

  /** Asserts a tab has finished showing its content: the graph, for Designer. */
  async expectTabLoaded(name: TabName): Promise<void> {
    await this.expectTabShown(name);
    if (name === 'Designer') await this.expectWorkflowDrawn();
  }

  /** Asserts the whole graph is on screen: every node and every edge. */
  async expectWorkflowDrawn(): Promise<void> {
    for (const id of NODE_IDS) await expect(this.node(id)).toBeVisible();
    await expect(this.edges).toHaveCount(NODE_IDS.length - 1);
  }
}
