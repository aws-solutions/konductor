// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
