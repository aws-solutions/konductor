// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesignerLayout, type LayoutStage } from './DesignerLayout';
import type { FieldFormChange } from './FieldForm';

const TEXT = [
  'format: konductor/1',
  'name: hello',
  'version: 0.1.0',
  'intent:',
  '  outcome: Add a greeting',
  'stages:',
  '  - name: write',
  '    agent: k-developer',
].join('\n');

const STAGE: LayoutStage = {
  name: 'write',
  rules: [
    { key: 'name', type: 'name', required: true },
    { key: 'agent', type: 'name', required: true },
  ],
  values: { name: 'write', agent: 'k-developer' },
  originalAgent: 'k-developer',
};

const AGENTS = [{ id: 'k-developer', summary: 'Code' }];

function renderLayout(stage: LayoutStage | undefined) {
  const changes: FieldFormChange[] = [];
  render(
    <DesignerLayout
      drawing={<p>The drawing</p>}
      yaml={{
        file: 'hello.yml',
        text: TEXT,
        stage: { name: 'write', range: { line: 7, end_line: 8 } },
      }}
      stage={stage}
      agents={AGENTS}
      onStageChange={(change) => changes.push(change)}
    >
      <p>The components</p>
    </DesignerLayout>,
  );
  return changes;
}

const tab = (name: string) => screen.getByRole('tab', { name });
const foldButton = () => screen.getByRole('button', { name: /side panel/ });

// Cloudscape keeps every panel mounted, so the one on show is the panel the
// selected tab points at.
function shownPanel(): HTMLElement {
  const selected = screen
    .getAllByRole('tab')
    .find((one) => one.getAttribute('aria-selected') === 'true')!;
  return document.getElementById(selected.getAttribute('aria-controls')!)!;
}

describe('DesignerLayout', () => {
  it('puts the components, the drawing and the side panel in their own landmarks', () => {
    renderLayout(STAGE);

    expect(
      within(screen.getByRole('region', { name: 'Components' })).getByText(
        'The components',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Drawing' })).getByText(
        'The drawing',
      ),
    ).toBeTruthy();
    const side = screen.getByRole('complementary', { name: 'Side panel' });
    expect(within(side).getByRole('tablist')).toBeTruthy();
    expect(within(side).getByRole('button', { name: /side panel/ })).toBe(
      foldButton(),
    );
  });

  it('shows the YAML tab first, with its panel named by the tab', () => {
    renderLayout(STAGE);

    expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
    expect(tab('Properties').getAttribute('aria-selected')).toBe('false');
    expect(shownPanel().getAttribute('aria-labelledby')).toBe(tab('YAML').id);
    expect(within(shownPanel()).getByText('format: konductor/1')).toBeTruthy();
  });

  it('shows the Properties tab on a click, with the form of the stage', () => {
    renderLayout(STAGE);
    fireEvent.click(tab('Properties'));

    expect(tab('Properties').getAttribute('aria-selected')).toBe('true');
    expect(
      within(shownPanel()).getByRole('form', { name: 'Keys of write' }),
    ).toBeTruthy();
  });

  it('groups editable and server-listed read-only fields in the stage panel', () => {
    renderLayout({
      ...STAGE,
      rules: [
        ...STAGE.rules,
        { key: 'prompt', type: 'text', required: false },
        { key: 'outcome', type: 'text', required: false },
      ],
      values: {
        ...STAGE.values,
        prompt: 'Write it',
        outcome: 'A document',
      },
      readOnlyKeys: ['outcome'],
    });
    fireEvent.click(tab('Properties'));

    expect(within(shownPanel()).getByText('Stage fields')).toBeTruthy();
    expect(within(shownPanel()).getByText('Other fields')).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'outcome' }).hasAttribute('readonly'),
    ).toBe(true);
  });

  it('keeps both panels mounted, so neither starts over on a switch', () => {
    renderLayout(STAGE);
    const yamlPanel = shownPanel();
    fireEvent.click(tab('Properties'));

    expect(shownPanel()).not.toBe(yamlPanel);
    expect(within(yamlPanel).getByText('format: konductor/1')).toBeTruthy();
  });

  it('passes on an edit of the form', () => {
    const changes = renderLayout(STAGE);
    fireEvent.click(tab('Properties'));
    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
      target: { value: 'draft' },
    });

    expect(changes.at(-1)?.values).toEqual({
      name: 'draft',
      agent: 'k-developer',
    });
  });

  it('folds and unfolds the side panel with its button, which says so', () => {
    renderLayout(STAGE);
    const button = foldButton();
    const side = document.getElementById(
      button.getAttribute('aria-controls')!,
    )!;

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toBe('Hide the side panel');
    expect(side.hidden).toBe(false);

    fireEvent.click(button);
    expect(foldButton().getAttribute('aria-expanded')).toBe('false');
    expect(foldButton().textContent).toBe('Show the side panel');
    expect(side.hidden).toBe(true);

    fireEvent.click(foldButton());
    expect(side.hidden).toBe(false);
    expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the tab picked across a fold', () => {
    renderLayout(STAGE);
    fireEvent.click(tab('Properties'));
    fireEvent.click(foldButton());
    fireEvent.click(foldButton());

    expect(tab('Properties').getAttribute('aria-selected')).toBe('true');
  });

  it('takes the columns in the order of the page: the components, the drawing, then the side panel', () => {
    render(
      <DesignerLayout
        drawing={<button type="button">Drawing node</button>}
        yaml={{ file: 'hello.yml', text: TEXT }}
        stage={STAGE}
        agents={AGENTS}
        onStageChange={() => {}}
      >
        <button type="button">Component</button>
      </DesignerLayout>,
    );
    const order = [
      ...document.body.querySelectorAll<HTMLElement>(
        'button, [role="tab"], [role="tablist"]',
      ),
    ].map((element) => element.textContent);

    expect(order.slice(0, 3)).toEqual([
      'Component',
      'Drawing node',
      'Hide the side panel',
    ]);
  });

  it('says to pick a stage when none is picked', () => {
    renderLayout(undefined);
    fireEvent.click(tab('Properties'));

    expect(
      within(shownPanel()).getByText(
        'Pick a stage in the drawing to edit its keys.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
  });
});
