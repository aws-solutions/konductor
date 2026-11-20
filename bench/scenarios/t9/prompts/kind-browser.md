
### Browser tests (this task has them)

The page runs in a real browser at scoring time, so part of the hidden tests drive it.
- `require('./bench-browser.js')` (supplied by `kit/`, never written by you): `const app = await open(__dirname)` serves the repository root on 127.0.0.1 and opens headless Chromium; `app.page` is a Playwright page, `app.url` the base URL, `app.errors` the uncaught page errors, `await app.close()` closes both. Use `try/finally` so the browser always closes. Open the page the request names with `app.page.goto(`${app.url}/<path>`)`.
- Hidden browser tests render the page, interact through roles and visible labels (`page.getByRole(...)`, `getByLabel`, keyboard presses), and assert on the DOM text and on accessibility roles and states (`aria-*`, focus, tab order, labels). They never rely on CSS class names or element ids the request does not name. At least {{NBROWSER}} of the tests must be browser tests, in their own file `hidden/browser.test.js`; they carry a 30 second per-test timeout.
- The fixture is served as static files: plain ES modules loaded by `index.html` with `<script type="module">`, no bundler, no network requests, no CDN, no web fonts.
- The `tests` check runs both files: `{{TESTCMD}}`.
- Keep each browser test short (under 3 seconds); the whole file must finish in 40 seconds.
