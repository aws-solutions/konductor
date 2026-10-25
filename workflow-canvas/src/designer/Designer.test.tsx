// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HELLO_DOCUMENT, failed, loaded } from '../test-support/fixtures';
import { Designer } from './Designer';

describe('Designer', () => {
  it('shows that the workflow is loading while there is no result', () => {
    render(<Designer result={undefined} />);

    expect(screen.getByText('Loading the workflow')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Workflow graph' })).toBeNull();
  });

  it('draws the intent, both stages and the end', () => {
    render(<Designer result={loaded(HELLO_DOCUMENT)} />);

    const graph = screen.getByRole('region', {
      name: 'Workflow graph',
    });
    const intent = within(graph).getByTestId('node-intent');
    expect(intent.textContent).toContain('Add a greeting to the README');
    expect(within(graph).getByTestId('node-stage-draft').textContent).toContain(
      'k-developer · kiro-cli',
    );
    expect(
      within(graph).getByTestId('node-stage-review').textContent,
    ).toContain('k-quality-assurance · kiro-cli');
    expect(within(graph).getByTestId('node-end')).toBeTruthy();
  });

  it('names the workflow in the header of the canvas', () => {
    render(<Designer result={loaded(HELLO_DOCUMENT)} />);

    expect(
      screen.getByRole('heading', { name: 'Workflow: hello' }),
    ).toBeTruthy();
  });

  it('shows the message when the load failed', () => {
    render(<Designer result={failed('The launch code is not valid.')} />);

    expect(screen.getByText('The workflow did not load')).toBeTruthy();
    expect(screen.getByText('The launch code is not valid.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Workflow graph' })).toBeNull();
  });

  it('says there is no file when the workflow has no text', () => {
    const none = { ...HELLO_DOCUMENT, text: null, view: null };

    render(<Designer result={loaded(none)} />);

    expect(screen.getByText('Nothing to draw')).toBeTruthy();
    expect(screen.getByText('The workflow has no file yet.')).toBeTruthy();
  });

  it('lists the problems when the file has errors', () => {
    const broken = {
      ...HELLO_DOCUMENT,
      view: null,
      diagnostics: [{ message: 'Missing key: intent', line: 2 }],
    };

    render(<Designer result={loaded(broken)} />);

    expect(
      screen.getByText('The workflow file has errors, so it cannot be drawn.'),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole('list', { name: 'Problems in the workflow file' }),
      ).getByText('Line 2: Missing key: intent'),
    ).toBeTruthy();
  });

  it('shows a problem that has no line without a line number', () => {
    const broken = {
      ...HELLO_DOCUMENT,
      view: null,
      diagnostics: [{ message: 'The file is empty', line: undefined }],
    };

    render(<Designer result={loaded(broken)} />);

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(within(list).getByText('The file is empty')).toBeTruthy();
    expect(list.textContent).not.toContain('Line');
  });

  it('lists every problem when the server repeats an identical one', () => {
    const repeated = { message: 'Unknown key: owner', line: 3 };
    const broken = {
      ...HELLO_DOCUMENT,
      view: null,
      diagnostics: [repeated, repeated],
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Designer result={loaded(broken)} />);

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(
      within(list).getAllByText('Line 3: Unknown key: owner'),
    ).toHaveLength(2);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('gives each node a name for a screen reader', () => {
    render(<Designer result={loaded(HELLO_DOCUMENT)} />);

    const graph = screen.getByRole('region', { name: 'Workflow graph' });
    for (const name of [
      'Intent: Add a greeting to the README',
      'Stage draft, agent k-developer, harness kiro-cli',
      'Stage review, agent k-quality-assurance, harness kiro-cli',
      'End',
    ]) {
      expect(within(graph).getByRole('group', { name })).toBeTruthy();
    }
  });
});
