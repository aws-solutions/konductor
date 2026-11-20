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
const shownPanel = () => screen.getByRole('tabpanel');

describe('DesignerLayout', () => {
  it('puts the components, the drawing and the side panel in place', () => {
    renderLayout(STAGE);

    expect(screen.getByText('The components')).toBeTruthy();
    expect(screen.getByText('The drawing')).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Side panel' })).toBeTruthy();
  });

  it('shows the YAML tab first, with its panel named by the tab', () => {
    renderLayout(STAGE);

    expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
    expect(tab('Properties').getAttribute('aria-selected')).toBe('false');
    expect(tab('YAML').tabIndex).toBe(0);
    expect(tab('Properties').tabIndex).toBe(-1);
    expect(shownPanel().getAttribute('aria-labelledby')).toBe(tab('YAML').id);
    expect(tab('YAML').getAttribute('aria-controls')).toBe(shownPanel().id);
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

  it.each([
    ['ArrowRight', 'Properties'],
    ['ArrowLeft', 'Properties'],
    ['End', 'Properties'],
  ])('moves to a tab with %s, and focuses it', (key, name) => {
    renderLayout(STAGE);
    tab('YAML').focus();
    fireEvent.keyDown(tab('YAML'), { key });

    expect(tab(name).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(name));
  });

  it('goes back to the first tab with Home', () => {
    renderLayout(STAGE);
    fireEvent.click(tab('Properties'));
    fireEvent.keyDown(tab('Properties'), { key: 'Home' });

    expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
  });

  it.each([
    ['Alt', { altKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
  ])('leaves an arrow key with %s to the browser', (_, modifier) => {
    renderLayout(STAGE);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
      ...modifier,
    });
    tab('YAML').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
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
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toBe('Show the side panel');
    expect(side.hidden).toBe(true);
    expect(screen.queryByRole('tablist')).toBeNull();

    fireEvent.click(button);
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
