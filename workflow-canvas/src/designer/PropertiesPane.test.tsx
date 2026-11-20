// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HELLO_DOCUMENT, HELLO_TEXT } from '../test-support/fixtures';
import { reduce, type EditEvent, type EditState } from './core';
import { openDocument } from './core/edit-state';
import { PropertiesPane } from './PropertiesPane';

function stateAfter(...events: EditEvent[]): EditState {
  let state = openDocument(HELLO_DOCUMENT);
  for (const event of events) state = reduce(state, event);
  if (!state) throw new Error('The sample cannot be edited.');
  return state;
}

function stateOfText(text: string, ...events: EditEvent[]): EditState {
  let state = openDocument({ ...HELLO_DOCUMENT, text });
  for (const event of events) state = reduce(state, event);
  if (!state) throw new Error('The text cannot be edited.');
  return state;
}

function show(state: EditState) {
  render(
    <PropertiesPane
      state={state}
      nameRef={null}
      onRename={() => {}}
      onAgent={() => {}}
      onPrompt={() => {}}
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

  describe('the prompt', () => {
    const area = () =>
      screen.getByRole('textbox', { name: 'prompt' }) as HTMLTextAreaElement;

    it('shows the text of the prompt and its count against the limit', () => {
      show(stateAfter());

      expect(area().value).toBe('Write the greeting to README.md.');
      expect(area().disabled).toBe(false);
      expect(screen.getByText('32 of 32768 characters')).toBeTruthy();
    });

    it('says near the text area that saving a prompt ends trust', () => {
      show(stateAfter());

      expect(
        screen.getByText(
          'Saving a prompt ends trust. The next Run asks again.',
        ),
      ).toBeTruthy();
    });

    it('says it also for a stage whose text area is off', () => {
      show(stateAfter({ type: 'select', id: 's2' }));

      expect(
        screen.getByText(
          'Saving a prompt ends trust. The next Run asks again.',
        ),
      ).toBeTruthy();
    });

    it('counts what is typed, in characters and not in UTF-16 units', () => {
      show(
        stateAfter({
          type: 'set-prompt',
          id: 's1',
          prompt: '\u{1F600}\u{1F600}',
        }),
      );

      expect(screen.getByText('2 of 32768 characters')).toBeTruthy();
    });

    it('marks the text area invalid past the limit, and still counts', () => {
      show(
        stateAfter({ type: 'set-prompt', id: 's1', prompt: 'x'.repeat(32769) }),
      );

      expect(screen.getByText('32769 of 32768 characters')).toBeTruthy();
      expect(area().getAttribute('aria-invalid')).toBe('true');
    });

    it('is off for a stage that reads a file, which shows its path and says why', () => {
      show(stateAfter({ type: 'select', id: 's2' }));

      expect(area().disabled).toBe(true);
      expect(
        screen.getByText('This stage reads its prompt from a file.'),
      ).toBeTruthy();
      const file = screen.getByRole('textbox', {
        name: 'prompt_file',
      }) as HTMLInputElement;
      expect(file.value).toBe('review.md');
      expect(file.readOnly).toBe(true);
    });

    it('shows both keys of a stage that has them, with the finding, and picks neither', () => {
      const both = HELLO_TEXT.replace(
        '    prompt_file: review.md',
        '    prompt: Check it.\n    prompt_file: review.md',
      );
      show(
        stateOfText(
          both,
          { type: 'select', id: 's2' },
          {
            type: 'checked',
            revision: 0,
            diagnostics: [
              {
                message: 'Set `prompt` or `prompt_file`, not both.',
                path: 'stages[1].prompt_file',
                line: 17,
                severity: 'error',
              },
            ],
          },
        ),
      );

      expect(area().value).toBe('Check it.');
      expect(area().disabled).toBe(true);
      expect(
        (
          screen.getByRole('textbox', {
            name: 'prompt_file',
          }) as HTMLInputElement
        ).value,
      ).toBe('review.md');
      expect(screen.getByText(/not both\./).closest('div')?.textContent).toBe(
        'Set prompt or prompt_file, not both.',
      );
    });

    it('shows the name of a key in the reason as code, without the ticks', () => {
      const text = HELLO_TEXT.replace(
        'prompt: Write the greeting to README.md.',
        'prompt: a\n    prompt: b',
      );
      show(stateOfText(text));

      const reason = screen.getByText(/has two/).closest('span');
      expect(reason?.textContent).toBe('This stage has two prompt keys.');
      expect(reason?.querySelector('code')?.textContent).toBe('prompt');
      expect(area().disabled).toBe(true);
    });

    it('shows markup and references as plain text', () => {
      const text = HELLO_TEXT.replace(
        'prompt: Write the greeting to README.md.',
        "prompt: '<script>alert(1)</script> <b>{run.goal}</b>'",
      );
      show(stateOfText(text));

      expect(area().value).toBe('<script>alert(1)</script> <b>{run.goal}</b>');
      expect(document.querySelector('script')).toBeNull();
      expect(document.querySelector('b')).toBeNull();
    });

    it('is read-only, and not off, while the workflow is read-only', () => {
      const state = openDocument({ ...HELLO_DOCUMENT, readOnly: true })!;
      show(state);

      expect(area().readOnly).toBe(true);
      expect(area().disabled).toBe(false);
    });
  });
});
