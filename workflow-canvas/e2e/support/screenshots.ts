// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

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

// Waits until every bundled font can paint.
async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(
    (faces) => Promise.all(faces.map((face) => document.fonts.load(face))),
    BUNDLED_FACES,
  );
  await page.evaluate(() => document.fonts.ready);
}

// Where everything on the canvas is: the view, and each node and link. React
// Flow places links from measurements that arrive a moment after a node is
// added, so a slow machine can still be moving them when the page looks done.
async function canvasGeometry(page: Page): Promise<string> {
  return page.evaluate(() =>
    ['.react-flow__viewport', '.react-flow__node', '.react-flow__edge-path']
      .flatMap((selector) =>
        [...document.querySelectorAll(selector)].map(
          (element) =>
            element.getAttribute('d') ??
            (element as HTMLElement).style.transform,
        ),
      )
      .join('|'),
  );
}

// Waits until two reads of the geometry, one poll apart, are the same.
async function waitForStableCanvas(page: Page): Promise<void> {
  let previous = '';
  await expect
    .poll(async () => {
      const current = await canvasGeometry(page);
      const steady = current === previous;
      previous = current;
      return steady;
    })
    .toBe(true);
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
  await waitForStableCanvas(page);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}
