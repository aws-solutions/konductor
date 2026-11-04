// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HELLO_DOCUMENT } from '../test-support/fixtures';
import { reduce, type EditEvent, type EditState } from './core';
import { openDocument } from './core/edit-state';
import { PropertiesPane } from './PropertiesPane';

function stateAfter(...events: EditEvent[]): EditState {
  let state = openDocument(HELLO_DOCUMENT);
  for (const event of events) state = reduce(state, event);
  if (!state) throw new Error('The sample cannot be edited.');
  return state;
}

function show(state: EditState) {
  render(
    <PropertiesPane
      state={state}
      nameRef={null}
      onRename={() => {}}
      onAgent={() => {}}
      onRemove={() => {}}
    />,
  );
}

describe('PropertiesPane', () => {
  it('marks a name that the check refused, with its sentence, and says the stage needs a fix', () => {
    show(
      stateAfter(
        { type: 'rename', id: 's1', name: 'review' },
        {
          type: 'checked',
          revision: 1,
          diagnostics: [
            {
              message: 'Duplicate stage name: review',
              path: 'stages[0].name',
              line: 4,
              severity: 'error',
            },
          ],
        },
      ),
    );

    expect(screen.getByText('Needs a fix')).toBeTruthy();
    expect(screen.getByText('Duplicate stage name: review')).toBeTruthy();
    expect(
      screen
        .getByRole('textbox', { name: 'name' })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('shows the name in an error as code, without backticks', () => {
    show(
      stateAfter(
        { type: 'rename', id: 's1', name: 'review' },
        {
          type: 'checked',
          revision: 1,
          diagnostics: [
            {
              message: 'The stage name `review` is already used.',
              path: 'stages[0].name',
              line: 4,
              severity: 'error',
            },
          ],
        },
      ),
    );

    const field = screen.getByText(/is already used\./).closest('div');
    expect(field?.textContent).toBe('The stage name review is already used.');
    expect(field?.querySelector('code')?.textContent).toBe('review');
  });

  it('says a stage is complete once a check has found nothing', () => {
    show(
      stateAfter(
        { type: 'rename', id: 's1', name: 'write' },
        { type: 'checked', revision: 1, diagnostics: [] },
      ),
    );

    expect(screen.getByText('Complete')).toBeTruthy();
  });

  it('says nothing about a draft that no check has spoken for', () => {
    show(stateAfter({ type: 'rename', id: 's1', name: 'write' }));

    expect(screen.queryByText('Complete')).toBeNull();
    expect(screen.queryByText('Needs a fix')).toBeNull();
  });
});
