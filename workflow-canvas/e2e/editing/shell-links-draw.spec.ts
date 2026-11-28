// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/editing-fixtures';
import type { DesignerPage } from '../support/designer-page';

const DRAFT_OUTCOME = '    outcome: Add the greeting to README.md\n';
const REVIEW_BLOCK = `  - name: review
    agent: k-quality-assurance
    outcome: Check that the greeting is clear and correct
`;

async function saveYaml(
  designer: DesignerPage,
  change: (text: string) => string,
) {
  await designer.openYaml();
  const yaml = designer.page.getByTestId('yaml-text');
  await yaml.fill(change(await yaml.inputValue()));
  await designer.expectSaveEnabled(true);
  await designer.save.click();
  await designer.expectStatus('Saved');
}

function withReference(text: string, prompt: string) {
  return text
    .replace(
      DRAFT_OUTCOME,
      `${DRAFT_OUTCOME}    outputs:\n      design: DESIGN.md\n`,
    )
    .replace(
      REVIEW_BLOCK,
      `${REVIEW_BLOCK}    prompt: ${JSON.stringify(prompt)}\n`,
    );
}

function edge(designer: DesignerPage) {
  return designer.page.getByRole('group', {
    name: 'Output design from stage draft to stage review',
  });
}

test('draws and deletes only generated reference lines', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Read {draft.design}.'),
  );
  await expect(edge(designer)).toBeVisible();
  await expect(
    designer.stage('draft').locator('.wf-data-port-out'),
  ).toBeVisible();
  await expect(
    designer.stage('review').locator('.wf-data-port-in'),
  ).toBeVisible();

  await edge(designer).click();
  await designer.page.keyboard.press('Delete');
  await expect(edge(designer)).toHaveCount(0);
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).not.toHaveValue(
    /Read \{draft\.design\}\./,
  );
});

test('keeps authored references and opens their stage', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Use {draft.design} as input.'),
  );
  const link = edge(designer);
  await link.click();
  await designer.page.getByRole('button', { name: 'Link actions' }).click();
  await designer.page.getByRole('menuitem', { name: 'Delete link' }).click();

  await expect(designer.page.getByTestId('link-message')).toHaveText(
    'This reference lives in the prompt text. Edit the prompt to remove it.',
  );
  await expect(link).toBeVisible();
  await expect(
    designer.page.getByRole('group', { name: /Stage review.*selected/ }),
  ).toBeVisible();
  await expect(designer.prompt).toHaveValue('Use {draft.design} as input.');
});
