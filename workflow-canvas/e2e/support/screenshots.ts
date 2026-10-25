// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const SCREENSHOT_DIR = fileURLToPath(
  new URL('../screenshots', import.meta.url),
);

// The faces that the page bundles. The browser loads a face only when text
// uses it, so the capture asks for each one, then waits until all can paint.
const BUNDLED_FACES = [
  '400 1em Outfit',
  '500 1em Outfit',
  '600 1em Outfit',
  '700 1em Outfit',
  "400 1em 'JetBrains Mono'",
  "700 1em 'JetBrains Mono'",
];

/** Waits until every bundled font can paint. */
async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(
    (faces) => Promise.all(faces.map((face) => document.fonts.load(face))),
    BUNDLED_FACES,
  );
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Saves a full-page PNG as `e2e/screenshots/<name>.png`, rendered with the
 * bundled fonts, with animations and the caret frozen so repeated runs match.
 */
export async function saveFullPageScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  await waitForFonts(page);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}
