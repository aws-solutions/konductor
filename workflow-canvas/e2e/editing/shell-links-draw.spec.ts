// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
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
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: /^Theme:/ }).click();
  await expectNoAccessibilityViolations(designer.page);
  await edge(designer).click();
  await designer.page.keyboard.press('Delete');
  await expect(edge(designer)).toHaveCount(0);
  await expect(designer.page.getByTestId('designer-live')).toHaveText(
    'Link design removed.',
  );
  await expect(
    designer.page.getByRole('group', { name: /Stage review.*selected/ }),
  ).toBeFocused();
  await designer.expectSaveEnabled(true);
  const undo = designer.page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();

  await undo.click();
  const yaml = designer.page.getByTestId('yaml-text');
  await expect(yaml).toHaveValue(/Read \{draft\.design\}\./);
  await designer.page.getByRole('button', { name: 'Redo' }).click();
  await expect(yaml).not.toHaveValue(/Read \{draft\.design\}\./);
  await expect(edge(designer)).toHaveCount(0);
});

test('preserves trailing prompt newlines when deleting a generated link', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Keep this.\n\nRead {draft.design}.'),
  );
  await edge(designer).click();
  await designer.page.keyboard.press('Delete');
  await designer.page.getByRole('tab', { name: 'Properties' }).click();
  await expect(designer.prompt).toHaveValue('Keep this.\n');
});

test('deletes generated links with Backspace', async ({ designer }) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Read {draft.design}.'),
  );
  await edge(designer).click();
  await designer.page.keyboard.press('Backspace');
  await expect(edge(designer)).toHaveCount(0);
  await expect(designer.page.getByTestId('designer-live')).toHaveText(
    'Link design removed.',
  );
});

test('opens the edge menu from the keyboard and deletes the link', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Read {draft.design}.'),
  );
  const link = edge(designer);
  const path = link.locator('.react-flow__edge-path');
  const idleStyle = await path.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      stroke: style.stroke,
      width: Number.parseFloat(style.strokeWidth),
    };
  });

  await link.focus();
  await designer.page.keyboard.press('Shift+Tab');
  await designer.page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const focusedStyle = await path.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      stroke: style.stroke,
      width: Number.parseFloat(style.strokeWidth),
    };
  });
  expect(focusedStyle.stroke).not.toBe(idleStyle.stroke);
  expect(focusedStyle.width).toBeGreaterThan(idleStyle.width);

  await designer.page.keyboard.press('Enter');
  await expect(link).toHaveClass(/selected/);
  await expect(
    designer.page.getByRole('button', { name: 'Link actions' }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(designer.page);
  await designer.page.getByRole('button', { name: 'Link actions' }).click();
  await designer.page.getByRole('menuitem', { name: 'Delete link' }).click();
  await expect(link).toHaveCount(0);
});

test('blocks deletion when the target prompt writer refuses it', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    text
      .replace(
        DRAFT_OUTCOME,
        `${DRAFT_OUTCOME}    outputs:\n      design: DESIGN.md\n`,
      )
      .replace(
        REVIEW_BLOCK,
        '  - {name: review, agent: k-quality-assurance, outcome: "Check that the greeting is clear and correct", prompt: "Read {draft.design}."}\n',
      ),
  );
  const link = edge(designer);
  await link.click();
  await expect(
    designer.page.getByRole('button', { name: 'Link actions' }),
  ).toBeDisabled();
  await designer.page.keyboard.press('Delete');
  await expect(link).toBeVisible();
  await expect(designer.page.getByTestId('designer-live')).not.toHaveText(
    'Link design removed.',
  );
});

test('draws a same-stage reference decoded from an escaped scalar', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    text.replace(
      DRAFT_OUTCOME,
      `${DRAFT_OUTCOME}    outputs:\n      design: DESIGN.md\n    prompt: "Read \\u007bdraft.design\\u007d."\n`,
    ),
  );
  const link = designer.page.getByRole('group', {
    name: 'Output design from stage draft to stage draft',
  });
  await expect(link).toBeVisible();
  const linkBounds = await link.locator('.react-flow__edge-path').boundingBox();
  const labelBounds = await link
    .locator('.react-flow__edge-text')
    .boundingBox();
  const stageBounds = await designer.stage('draft').boundingBox();
  if (!linkBounds || !labelBounds || !stageBounds) {
    throw new Error('The same-stage link geometry is unavailable.');
  }
  expect(linkBounds.y + linkBounds.height).toBeGreaterThan(
    stageBounds.y + stageBounds.height + 10,
  );
  expect(labelBounds.x).toBeGreaterThan(stageBounds.x + stageBounds.width);
});

test('keeps deletion blocked while raw YAML is pending', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Read {draft.design}.'),
  );
  await designer.openYaml();
  const yaml = designer.page.getByTestId('yaml-text');
  await yaml.fill(`${await yaml.inputValue()}# pending\n`);

  await edge(designer).click();
  await expect(
    designer.page.getByRole('button', { name: 'Link actions' }),
  ).toBeDisabled();
  await designer.page.keyboard.press('Delete');
  await expect(edge(designer)).toBeVisible();
  await expect(yaml).toHaveValue(/# pending/);
});

test('keeps deletion blocked for a server read-only workflow', async ({
  designer,
}) => {
  await saveYaml(designer, (text) =>
    withReference(text, 'Read {draft.design}.'),
  );
  await designer.page.route('**/api/workflow', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, read_only: true } });
  });
  await designer.page.reload();

  const link = edge(designer);
  await link.click();
  await expect(
    designer.page.getByRole('button', { name: 'Link actions' }),
  ).toBeDisabled();
  await designer.page.keyboard.press('Delete');
  await designer.page.keyboard.press('Backspace');
  await expect(link).toBeVisible();
  await expect(designer.page.getByTestId('designer-live')).not.toHaveText(
    'Link design removed.',
  );
  await designer.openYaml();
  await expect(designer.page.getByTestId('yaml-text')).toHaveValue(
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
