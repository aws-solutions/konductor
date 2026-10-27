// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const SCREENSHOT_DIR = fileURLToPath(
  new URL('../screenshots', import.meta.url),
);

// Cloudscape lists Open Sans first in its font stack but does not ship it, so
// the page falls back to whichever font the machine has. Loading the same file
// on every machine keeps the text identical.
const FONT_FAMILY = 'Open Sans';
const FONT_FILE = createRequire(import.meta.url).resolve(
  '@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2',
);

/** Loads the bundled font into the page and waits until it can paint. */
async function pinFont(page: Page): Promise<void> {
  const fontData = (await readFile(FONT_FILE)).toString('base64');
  await page.addStyleTag({
    content: `@font-face {
      font-family: '${FONT_FAMILY}';
      font-weight: 300 800;
      src: url(data:font/woff2;base64,${fontData}) format('woff2');
    }`,
  });
  await page.evaluate(
    (family) => document.fonts.load(`1em '${family}'`),
    FONT_FAMILY,
  );
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Saves a full-page PNG as `e2e/screenshots/<name>.png`, rendered with the
 * pinned font, with animations and the caret frozen so repeated runs match.
 */
export async function saveFullPageScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  await pinFont(page);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}
