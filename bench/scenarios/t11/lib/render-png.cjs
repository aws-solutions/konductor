#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders an HTML or SVG file to a PNG with headless Chromium, for the media fixtures of T11 (a screenshot of a bug, a
// photo-like whiteboard sketch). The authoring kit copies it; the generated PNG is committed in the fixture and the
// HTML/SVG source under authoring/<id>/gen, so the image can be made again.
//   node render-png.cjs <in.html|in.svg> <out.png> [width] [height]
// Needs Playwright with its Chromium (PLAYWRIGHT_DIR, default /var/tmp/pw).

const path = require('node:path');

async function render(input, output, width = 1280, height = 800) {
  const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || '/var/tmp/pw', 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`file://${path.resolve(input)}`);
    await page.screenshot({ path: output, fullPage: false, animations: 'disabled' });
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const [input, output, w, h] = process.argv.slice(2);
  if (!input || !output) { console.error('usage: render-png.cjs <in.html|in.svg> <out.png> [width] [height]'); process.exit(2); }
  render(input, output, Number(w) || 1280, Number(h) || 800).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { render };
