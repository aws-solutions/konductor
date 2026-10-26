// SPDX-License-Identifier: Apache-2.0
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/fixtures';
import type { WorkflowCanvasPage } from '../support/workflow-canvas-page';

const DARK_CANVAS = 'rgb(11, 10, 18)';
const LIGHT_CANVAS = 'rgb(245, 243, 238)';

const BAND_RGB = 'rgb(20, 16, 38)';
const BAND_DIVIDER_RGB = 'rgb(42, 36, 80)';
const BAND_LINK_RGB = 'rgb(196, 178, 255)';

test('shows the top bar, the breadcrumb and the title of the page', async ({
  canvas,
}) => {
  await expect(
    canvas.page.getByRole('link', { name: 'Workflow canvas' }),
  ).toBeVisible();
  await expect(canvas.themeButton).toBeVisible();
  await expect(canvas.breadcrumbs).toContainText('Workflows');
  await expect(canvas.breadcrumbs).toContainText('hello');
  await expect(canvas.title).toHaveText('Workflow canvas');
});

test('self-hosts the fonts of the theme', async ({ canvas }) => {
  const requested: string[] = [];
  canvas.page.on('request', (request) => requested.push(request.url()));
  await canvas.page.reload();
  await canvas.title.waitFor();

  const fonts = await canvas.page.evaluate(async () => {
    // A face downloads only when text uses it, so ask for each one.
    const [outfit, mono] = await Promise.all([
      document.fonts.load('400 1em Outfit'),
      document.fonts.load("400 1em 'JetBrains Mono'"),
    ]);
    return {
      outfit: outfit.length > 0,
      mono: mono.length > 0,
      body: getComputedStyle(document.body).fontFamily,
    };
  });

  expect(fonts.outfit).toBe(true);
  expect(fonts.mono).toBe(true);
  expect(fonts.body).toContain('Outfit');
  const origin = new URL(canvas.page.url()).origin;
  expect(
    requested.filter(
      (url) => !url.startsWith(origin) && !url.startsWith('data:'),
    ),
  ).toEqual([]);
});

test.describe('light first load', () => {
  test.use({ colorScheme: 'light' });

  test('starts light and does not save a choice nobody made', async ({
    canvas,
  }) => {
    await expect(canvas.themeButton).toHaveText('Theme: light');
    await expect(canvas.graph).toHaveCSS('background-color', LIGHT_CANVAS);
    expect(await canvas.page.evaluate(() => localStorage.length)).toBe(0);
  });
});

test.describe('dark system setting', () => {
  test.use({ colorScheme: 'dark' });

  test('starts dark when the system asks for it', async ({ canvas }) => {
    await expect(canvas.themeButton).toHaveText('Theme: dark');
    await expect(canvas.page.locator('html')).toHaveAttribute(
      'data-theme',
      'dark',
    );
  });
});

test('switches to the dark mode and back', async ({ canvas }) => {
  await canvas.switchTheme();

  await expect(canvas.page.locator('html')).toHaveAttribute(
    'data-theme',
    'dark',
  );
  await expect(canvas.graph).toHaveCSS('background-color', DARK_CANVAS);

  await canvas.switchTheme();

  await expect(canvas.page.locator('html')).toHaveAttribute(
    'data-theme',
    'light',
  );
  await expect(canvas.graph).toHaveCSS('background-color', LIGHT_CANVAS);
});

test('remembers the choice after a reload', async ({ canvas }) => {
  await canvas.switchTheme();

  await canvas.open(STUB_LAUNCH_CODE);

  await expect(canvas.themeButton).toHaveText('Theme: dark');
});

test('a saved choice wins over the system setting', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.page.emulateMedia({ colorScheme: 'light' });

  await canvas.open(STUB_LAUNCH_CODE);

  await expect(canvas.themeButton).toHaveText('Theme: dark');
});

test('has no axe violations in the light mode, text contrast included', async ({
  canvas,
}) => {
  await canvas.expectWorkflowDrawn();

  await expectNoAccessibilityViolations(canvas.page);
});

test('has no axe violations in the dark mode, text contrast included', async ({
  canvas,
}) => {
  await canvas.switchTheme();
  await canvas.expectWorkflowDrawn();

  await expectNoAccessibilityViolations(canvas.page);
});

test('keeps the keyboard ring of a node visible in the dark mode', async ({
  canvas,
}) => {
  await canvas.switchTheme();
  await canvas.expectWorkflowDrawn();
  await canvas.tab('Designer').focus();

  await canvas.tabToNextNode();

  await expect(
    canvas.page.locator('.react-flow__node:focus .wf-focus-ring'),
  ).toHaveCSS('stroke', 'rgb(167, 139, 250)');
});

test('switches with the keyboard', async ({ canvas }) => {
  await canvas.themeButton.focus();

  await canvas.page.keyboard.press('Enter');

  await expect(canvas.themeButton).toHaveText('Theme: dark');
});

// The strip of the tabs, the selected-tab indicator and the rule under it.
async function expectTabStripOnBand(canvas: WorkflowCanvasPage) {
  const strip = canvas.page
    .getByRole('tablist')
    .locator('xpath=ancestor::*[2]');
  await expect(strip).toHaveCSS('background-color', BAND_RGB);
  await expect(strip).toHaveCSS('border-bottom-color', BAND_DIVIDER_RGB);
  // The indicator is drawn after the element that wraps the tab button.
  const indicator = await canvas
    .tab('Designer')
    .evaluate(
      (tab) => getComputedStyle(tab.parentElement!, '::after').backgroundColor,
    );
  expect(indicator).toBe(BAND_LINK_RGB);
}

test('puts the tab strip on the dark band in the light mode', async ({
  canvas,
}) => {
  await expectTabStripOnBand(canvas);
});

test('puts the tab strip on the dark band in the dark mode', async ({
  canvas,
}) => {
  await canvas.switchTheme();

  await expectTabStripOnBand(canvas);
});

test('sets the saved mode before the app script runs', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.page.route('**/*', (route) =>
    route.request().resourceType() === 'script'
      ? route.abort()
      : route.fallback(),
  );

  await canvas.page.reload();

  const root = canvas.page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(canvas.themeButton).toHaveCount(0);
});
