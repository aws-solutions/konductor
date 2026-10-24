// SPDX-License-Identifier: Apache-2.0
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Fails with the rule ids and offending nodes when axe finds a violation. */
export async function expectNoAccessibilityViolations(
  page: Page,
): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
}
