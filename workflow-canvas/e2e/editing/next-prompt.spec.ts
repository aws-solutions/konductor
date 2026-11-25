// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/editing-fixtures';

// This spec saves to the stub, which keeps one workflow, so it lives with the
// other saving specs: they run one after the other in one worker, after the
// specs that only read. The sample goes back before the page opens, so the
// text the page loads is the one these tests expect, and again after.

const PROMPT = 'Write a warmer greeting to README.md.';

test('saves the prompt of a stage, which is still there after a reload', async ({
  designer,
}) => {
  await expect(designer.prompt).toBeEditable();

  await designer.prompt.fill(PROMPT);
  await designer.expectStatus('Unsaved changes');

  await designer.save.click();
  await designer.expectStatus('Saved');
  // The prompt reached the file, so the text shows it too.
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    new RegExp(`prompt: ${PROMPT}`),
  );

  await designer.page.reload();

  await designer.openProperties();
  await expect(designer.prompt).toHaveValue(PROMPT);
});
