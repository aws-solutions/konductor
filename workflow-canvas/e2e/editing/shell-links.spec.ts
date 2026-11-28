// SPDX-License-Identifier: Apache-2.0
import type { Locator } from '@playwright/test';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/editing-fixtures';
import type { DesignerPage } from '../support/designer-page';

const REVIEW_BLOCK = `  - name: review
    agent: k-quality-assurance
    outcome: Check that the greeting is clear and correct
`;

function center(box: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragLink(
  designer: DesignerPage,
  sourceName: string,
  targetName: string,
) {
  const source = designer.stage(sourceName).locator('.wf-data-port-out');
  const target = designer.stage(targetName).locator('.wf-data-port-in');
  const [sourceBox, targetBox] = await Promise.all([
    source.boundingBox(),
    target.boundingBox(),
  ]);
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const from = center(sourceBox!);
  const to = center(targetBox!);
  await designer.page.mouse.move(from.x, from.y);
  await designer.page.mouse.down();
  await designer.page.mouse.move(to.x, to.y, { steps: 12 });
  await designer.page.mouse.up();
}

async function dragSequence(
  designer: DesignerPage,
  sourceName: string,
  targetName: string,
) {
  const source = designer.stage(sourceName).locator('.wf-port-out');
  const target = designer.stage(targetName).locator('.wf-port-in');
  const [sourceBox, targetBox] = await Promise.all([
    source.boundingBox(),
    target.boundingBox(),
  ]);
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const from = center(sourceBox!);
  const to = center(targetBox!);
  await designer.page.mouse.move(from.x, from.y);
  await designer.page.mouse.down();
  await designer.page.mouse.move(to.x, to.y, { steps: 12 });
  await designer.page.mouse.up();
}

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

function dataEdge(designer: DesignerPage, output: string) {
  return designer.page.getByRole('group', {
    name: `Output ${output} from stage draft to stage review`,
  });
}

test('run-order handles do not create data links', async ({ designer }) => {
  await dragSequence(designer, 'draft', 'review');
  await expect(designer.page.getByTestId('link-output-dialog')).toHaveCount(0);
  await designer.expectStatus('No changes');
});

test('drag with no output can be cancelled or confirmed in the dialog', async ({
  designer,
}) => {
  await dragLink(designer, 'draft', 'review');
  const dialog = designer.page.getByTestId('link-output-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Output name' }).fill('Bad_Name');
  await expect(
    dialog.getByRole('textbox', { name: 'Output name' }),
  ).toHaveAttribute('aria-invalid', 'true');
  await expect(designer.page.getByTestId('designer-live')).toContainText(
    'An output name must start',
  );
  await dialog.getByRole('textbox', { name: 'Output name' }).fill('design');
  const path = dialog.getByRole('textbox', { name: 'Output path' });
  for (const invalid of ['../DESIGN.md', '/tmp/x', 'a\\b', 'a//b', 'C:x']) {
    await path.fill(invalid);
    await expect(path).toHaveAttribute('aria-invalid', 'true');
    await expect(
      dialog.getByRole('button', { name: 'Link output', exact: true }),
    ).toBeDisabled();
  }
  await expect(designer.page.getByTestId('designer-live')).toContainText(
    'Use a relative path',
  );
  await expectNoAccessibilityViolations(designer.page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await designer.expectStatus('No changes');
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();

  await dragLink(designer, 'draft', 'review');
  await dialog.getByRole('textbox', { name: 'Output name' }).fill('design');
  await dialog.getByRole('textbox', { name: 'Output path' }).fill('DESIGN.md');
  await expectNoAccessibilityViolations(designer.page);
  await dialog
    .getByRole('button', { name: 'Link output', exact: true })
    .click();

  await expect(designer.page.getByTestId('designer-live')).toHaveText(
    'Linked draft.design to review.',
  );
  await expect(
    designer.page
      .getByRole('tabpanel', { name: 'Properties' })
      .getByRole('textbox', { name: 'name' }),
  ).toBeFocused();
  await expect(dataEdge(designer, 'design')).toBeVisible();

  const undo = designer.page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await designer.openYaml();
  const yaml = designer.page.getByTestId('yaml-text');
  await expect(yaml).not.toHaveValue(/design: DESIGN.md/);
  await expect(yaml).not.toHaveValue(/Read \{draft\.design\}\./);
  await designer.page.getByRole('button', { name: 'Redo' }).click();
  await expect(yaml).toHaveValue(/design: DESIGN.md/);
  await expect(yaml).toHaveValue(/Read \{draft\.design\}\./);

  await designer.save.click();
  await designer.expectStatus('Saved');
  await designer.page.reload();
  await expect(dataEdge(designer, 'design')).toBeVisible();
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /outputs:\n      design: DESIGN.md/,
  );
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
    /Read \{draft\.design\}\./,
  );
});

test('drag with several outputs links the chosen output', async ({
  designer,
}) => {
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add output' }).click();
  await panel.getByRole('textbox', { name: 'Output name 1' }).fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');
  await panel.getByRole('button', { name: 'Add output' }).click();
  await panel.getByRole('textbox', { name: 'Output name 2' }).fill('notes');
  await panel.getByRole('textbox', { name: 'Output path 2' }).fill('NOTES.md');

  await dragLink(designer, 'draft', 'review');
  const dialog = designer.page.getByTestId('link-output-dialog');
  await dialog.getByRole('button', { name: /Output/ }).click();
  await designer.page.getByRole('option', { name: /notes/ }).click();
  await dialog
    .getByRole('button', { name: 'Link output', exact: true })
    .click();

  await expect(dataEdge(designer, 'notes')).toBeVisible();
  await expect(dataEdge(designer, 'design')).toHaveCount(0);
  await designer.save.click();
  await designer.expectStatus('Saved');
});

test('one output links with an announcement and target focus', async ({
  designer,
}) => {
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add output' }).click();
  await panel.getByRole('textbox', { name: 'Output name 1' }).fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');

  await dragLink(designer, 'draft', 'review');

  await expect(dataEdge(designer, 'design')).toBeVisible();
  await expect(designer.page.getByTestId('designer-live')).toHaveText(
    'Linked draft.design to review.',
  );
  await expect(panel.getByRole('textbox', { name: 'name' })).toBeFocused();
});

test('rejects a link that would exceed the prompt limit', async ({
  designer,
}) => {
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add output' }).click();
  await panel.getByRole('textbox', { name: 'Output name 1' }).fill('design');
  await panel.getByRole('textbox', { name: 'Output path 1' }).fill('DESIGN.md');
  await designer.stage('review').click();
  await designer.prompt.fill('x'.repeat(32768));

  await dragLink(designer, 'draft', 'review');

  await expect(designer.page.getByTestId('link-message')).toHaveText(
    'The linked prompt would exceed 32768 characters.',
  );
  await expect(dataEdge(designer, 'design')).toHaveCount(0);
  await expect(designer.prompt).toHaveValue('x'.repeat(32768));
});

test('refused drops show a reason and leave the draft unchanged', async ({
  designer,
}) => {
  const message = designer.page.getByTestId('link-message');

  await dragLink(designer, 'draft', 'draft');
  await expect(message).toHaveText('A stage cannot link an output to itself.');
  await designer.expectStatus('No changes');

  await dragLink(designer, 'review', 'draft');
  await expect(message).toHaveText('An output can link only to a later stage.');
  await designer.expectStatus('No changes');

  await saveYaml(designer, (text) =>
    text.replace(REVIEW_BLOCK, `${REVIEW_BLOCK}    prompt_file: review.md\n`),
  );
  await dragLink(designer, 'draft', 'review');
  await expect(message).toHaveText(
    'A stage with prompt_file cannot take a data link.',
  );
  await designer.expectStatus('Saved');

  await saveYaml(designer, (text) =>
    text.replace(
      `${REVIEW_BLOCK}    prompt_file: review.md\n`,
      '  - {name: review, agent: k-quality-assurance, outcome: "Check that the greeting is clear and correct"}\n',
    ),
  );
  await dragLink(designer, 'draft', 'review');
  await expect(message).toContainText('flow form');
  await designer.expectStatus('Saved');
});

test('edge deletion removes generated lines but keeps authored references', async ({
  designer,
}) => {
  await dragLink(designer, 'draft', 'review');
  const dialog = designer.page.getByTestId('link-output-dialog');
  await dialog.getByRole('textbox', { name: 'Output name' }).fill('design');
  await dialog.getByRole('textbox', { name: 'Output path' }).fill('DESIGN.md');
  await dialog
    .getByRole('button', { name: 'Link output', exact: true })
    .click();
  let edge = dataEdge(designer, 'design');
  await edge.click();
  await designer.page.keyboard.press('Delete');
  await expect(edge).toHaveCount(0);
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).not.toHaveValue(
    /Read \{draft\.design\}\./,
  );
  await designer.save.click();
  await designer.expectStatus('Saved');

  await saveYaml(designer, (text) =>
    text.replace(
      REVIEW_BLOCK,
      `${REVIEW_BLOCK}    prompt: "Use {draft.design} as input."\n`,
    ),
  );
  edge = dataEdge(designer, 'design');
  await edge.click();
  await designer.page.getByRole('button', { name: 'Link actions' }).click();
  await designer.page.getByRole('menuitem', { name: 'Delete link' }).click();
  await expect(designer.page.getByTestId('link-message')).toHaveText(
    'This reference lives in the prompt text. Edit the prompt to remove it.',
  );
  await expect(edge).toBeVisible();
  await expect(
    designer.page.getByRole('group', { name: /Stage review.*selected/ }),
  ).toBeVisible();
  await expect(designer.prompt).toHaveValue('Use {draft.design} as input.');
});

test('the keyboard path uses the same output dialog', async ({ designer }) => {
  await designer.stage('review').click();
  await designer.stage('draft').click();
  const panel = designer.page.getByRole('tabpanel', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Link output to...' }).click();
  await designer.page.getByRole('menuitem', { name: 'review' }).click();
  const dialog = designer.page.getByTestId('link-output-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await designer.expectStatus('No changes');
});
