// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';

// Script on the page can read the session token, so the page allows only its
// own files: no inline script and no other origin.
test('the page runs only its own scripts and breaks no rule of its policy', async ({
  canvas,
  page,
}) => {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (rule: string) =>
    violations.push(rule),
  );
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      (
        window as unknown as { reportViolation(rule: string): void }
      ).reportViolation(event.violatedDirective),
    ),
  );
  await page.reload();
  await canvas.expectWorkflowDrawn();
  expect(violations).toEqual([]);

  const inlineScriptRan = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.inlineScriptRan = true';
    document.head.append(script);
    return 'inlineScriptRan' in window;
  });

  expect(inlineScriptRan).toBe(false);
  await expect.poll(() => violations).toEqual(['script-src-elem']);
});
