# playwright fixture key
e2e/global-setup.ts: hardcoded user/password (L7-8), unscoped selectors (hosted UI has hidden duplicate; use :visible), full URL instead of baseURL, waitForURL('**') + networkidle (L10) instead of /distributions or user-menu marker, no mkdir fixtures/auth.
playwright.config.ts: no globalSetup, storageState or baseURL from PLAYWRIGHT_BASE_URL.
.gitignore: missing fixtures/auth/.
e2e/existing.spec.ts: L5 getByRole('radio') on Tiles (use label filter + input radio force); L6 and L8 unexplained .first() / raw CSS; L7 option not scoped to listbox and select not opened; L14 row.click instead of radio force; L17 Cancel not scoped to dialog footer.
Skill also forbids installing Playwright (node_modules must stay absent).
