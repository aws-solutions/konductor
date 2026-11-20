// SPDX-License-Identifier: Apache-2.0
'use strict';

// Browser helper for hidden tests of frontend tasks (a task's .bench-lib.json copies it to hidden/bench-browser.js).
//   const { open } = require('./bench-browser.js');
//   const app = await open(__dirname);   // serves the workspace root on 127.0.0.1 and opens headless Chromium
//   await app.page.goto(`${app.url}/index.html`); ... await app.close();
// Playwright and Chromium are installed without root outside the workspace. Defaults: /var/tmp/pw (npm prefix) and
// /var/tmp/pw-browsers; BENCH_PLAYWRIGHT and PLAYWRIGHT_BROWSERS_PATH override them. Chromium runs with --no-sandbox
// (measured peak memory of one run: about 0.7 GB).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

/** Serves `root` as static files on 127.0.0.1 (a free port). Paths that leave `root` get 403, missing files 404. */
function serve(root) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(base, `.${rel.endsWith('/') ? `${rel}index.html` : rel}`);
    if (file !== base && !file.startsWith(`${base}${path.sep}`)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  })));
}

/** Opens a page of headless Chromium on a static server for `root`. `errors` collects uncaught page errors. */
async function open(root, options = {}) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/var/tmp/pw-browsers';
  const { chromium } = require(process.env.BENCH_PLAYWRIGHT || '/var/tmp/pw/node_modules/playwright');
  const server = await serve(root);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(options.page);
  page.setDefaultTimeout(options.timeoutMs || 5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, url: server.url, errors, close: async () => { await browser.close(); await server.close(); } };
}

module.exports = { serve, open };
