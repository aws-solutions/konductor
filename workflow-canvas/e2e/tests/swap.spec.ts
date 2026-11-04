// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { expect, test } from '../support/editing-fixtures';
import { sharedSession } from '../support/session';

const NEW_CODE = 'nQ3x7vJ2kLmN9pRs4TuVw5Y_-ab12';

// Answers the next session call with another harness, and records the calls.
async function offerOtherSessions(page: Page): Promise<string[]> {
  const sessions: string[] = [];
  await page.route('**/api/session', (route) => {
    sessions.push(route.request().postData() ?? '');
    return route.fulfill({
      json: { ...sharedSession(), harness: 'other-harness' },
    });
  });
  await page.route('**/barrier', (route) => route.fulfill({ body: 'ok' }));
  return sessions;
}

// Pastes the launch address and returns what the page asked in the dialog.
async function pasteCode(page: Page, accept: boolean): Promise<string> {
  const asked = page.waitForEvent('dialog');
  await page.evaluate((code) => (window.location.hash = code), NEW_CODE);
  const dialog = await asked;
  const message = dialog.message();
  await (accept ? dialog.accept() : dialog.dismiss());
  return message;
}

test('asks before a pasted launch address drops unsaved changes, and keeps them when declined', async ({
  designer,
}) => {
  const sessions = await offerOtherSessions(designer.page);
  await designer.rename('drafting');

  const question = await pasteCode(designer.page, false);

  expect(question).toContain('drops your unsaved changes');
  await designer.page.evaluate(() => fetch('/barrier'));
  expect(sessions).toEqual([]);
  await expect(designer.name).toHaveValue('drafting');
});

test('opens the pasted workflow when the person lets the changes go', async ({
  designer,
}) => {
  await offerOtherSessions(designer.page);
  await designer.rename('drafting');

  await pasteCode(designer.page, true);

  await expect(designer.stage('draft')).toContainText('other-harness');
  await expect(designer.name).toHaveValue('draft');
});
