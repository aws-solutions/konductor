// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const SCREENSHOT_DIR = fileURLToPath(
  new URL('../screenshots/', import.meta.url),
);

/**
 * Saves a full-page PNG as `e2e/screenshots/<name>.png`. Waits for web fonts
 * and freezes animations and the caret, so repeated runs match.
 */
export async function saveFullPageScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}${name}.png`,
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}
