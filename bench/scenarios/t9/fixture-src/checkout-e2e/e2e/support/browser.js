'use strict';

// Shared set-up for the end-to-end tests: serves site/ on 127.0.0.1 and opens headless Chromium.
//   const { openSite } = require('./support/browser.js');
//   const app = await openSite();   // app.page (a Playwright page), app.url, app.errors, await app.close()
// Playwright is not a dependency of this repository: the CI image installs it once, at the path in
// e2e/e2e.config.json. PLAYWRIGHT_MODULE and PLAYWRIGHT_BROWSERS_PATH override that file.

const { after } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', '..', 'site');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'e2e.config.json'), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(root, `.${rel.endsWith('/') ? `${rel}index.html` : rel}`);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openSite() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || CONFIG.browsersPath;
  const browser = await sharedBrowser();
  const server = await serve(SITE);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    page,
    url,
    errors,
    close: async () => { await context.close(); await new Promise((done) => server.close(done)); },
  };
}

// One Chromium per test file: each openSite() gets a fresh context (no shared cookies or storage), and the browser
// closes when the file's tests are done.
let launched = null;
function sharedBrowser() {
  if (!launched) {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || CONFIG.playwrightModule);
    launched = chromium.launch({ headless: true, args: ['--no-sandbox'] });
  }
  return launched;
}

after(async () => { if (launched) await (await launched).close(); });

module.exports = { openSite };
