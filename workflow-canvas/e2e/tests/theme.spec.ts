// SPDX-License-Identifier: Apache-2.0
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/fixtures';

const DARK_CANVAS = 'rgb(11, 10, 18)';
const LIGHT_CANVAS = 'rgb(245, 243, 238)';

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
    await expect(canvas.page.locator('body')).toHaveClass(/awsui-dark-mode/);
  });
});

test('switches to the dark mode and back', async ({ canvas }) => {
  await canvas.switchTheme();

  await expect(canvas.page.locator('body')).toHaveClass(/awsui-dark-mode/);
  await expect(canvas.graph).toHaveCSS('background-color', DARK_CANVAS);

  await canvas.switchTheme();

  await expect(canvas.page.locator('body')).not.toHaveClass(/awsui-dark-mode/);
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

  await expect(canvas.page.locator('.react-flow__node:focus')).toHaveCSS(
    'outline-color',
    'rgb(167, 139, 250)',
  );
});

test('switches with the keyboard', async ({ canvas }) => {
  await canvas.themeButton.focus();

  await canvas.page.keyboard.press('Enter');

  await expect(canvas.themeButton).toHaveText('Theme: dark');
});
