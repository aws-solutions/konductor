// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/editing-fixtures';
import type { Page } from '@playwright/test';

// The draft lives in the page only, so closing or reloading the page throws
// it away. The browser asks first, but only if the page asks it to. Nothing
// here saves, so the stub keeps its workflow. `close` with `runBeforeUnload`
// is the way a test leaves the page like a person does: it returns before the
// browser has asked or closed, so each helper waits for what it expects.

/** Leaves the page and returns the kind of dialog the browser asked, then stays. */
async function leaveAndStay(page: Page): Promise<string> {
  const asked = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  await dialog.dismiss();
  return dialog.type();
}

/** Leaves the page and returns the kinds of dialog asked until it closed. */
async function leaveWithoutStaying(page: Page): Promise<string[]> {
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
  return asked;
}

test('asks before the page is closed with changes that are not saved', async ({
  designer,
}) => {
  // A click first: the browser asks only after the person used the page.
  await designer.stage('draft').click();
  await designer.rename('drafting');

  expect(await leaveAndStay(designer.page)).toBe('beforeunload');

  expect(designer.page.isClosed()).toBe(false);
  await expect(designer.name).toHaveValue('drafting');
});

test('lets the page go without asking when nothing has changed', async ({
  designer,
}) => {
  await designer.stage('draft').click();

  expect(await leaveWithoutStaying(designer.page)).toEqual([]);
});

test('lets the page go without asking when the change is put back', async ({
  designer,
}) => {
  await designer.stage('draft').click();
  await designer.rename('drafting');
  await designer.rename('draft');

  expect(await leaveWithoutStaying(designer.page)).toEqual([]);
});
