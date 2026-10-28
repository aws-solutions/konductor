// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  HELLO_DOCUMENT,
  HELLO_VIEW,
  failed,
  loaded,
} from '../test-support/fixtures';
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
      diagnostics: [
        {
          message: 'Missing key: intent',
          line: 2,
          path: '',
          severity: 'error' as const,
        },
      ],
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

  it('shows the names in a problem as code, without backticks', () => {
    const broken = {
      ...HELLO_DOCUMENT,
      view: null,
      diagnostics: [
        {
          message: 'The mapping needs the key `intent`.',
          line: 2,
          path: '',
          severity: 'error' as const,
        },
      ],
    };

    render(<Designer result={loaded(broken)} />);

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(list.textContent).toBe('Line 2: The mapping needs the key intent.');
    expect(list.querySelector('code')?.textContent).toBe('intent');
  });

  it('shows the names in the reason a load failed as code, without backticks', () => {
    render(<Designer result={failed('The key `stages` is missing.')} />);

    expect(screen.getByRole('alert').textContent).toContain(
      'The key stages is missing.',
    );
  });

  it('shows a problem that has no line without a line number', () => {
    const broken = {
      ...HELLO_DOCUMENT,
      view: null,
      diagnostics: [
        {
          message: 'The file is empty',
          line: undefined,
          path: '',
          severity: 'error' as const,
        },
      ],
    };

    render(<Designer result={loaded(broken)} />);

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(within(list).getByText('The file is empty')).toBeTruthy();
    expect(list.textContent).not.toContain('Line');
  });

  it('lists every problem when the server repeats an identical one', () => {
    const repeated = {
      message: 'Unknown key: owner',
      line: 3,
      path: 'owner',
      severity: 'error' as const,
    };
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

  describe('text longer than a node can show', () => {
    const LONG_NAME = 'n'.repeat(64);
    const LONG_AGENT = 'a'.repeat(64);
    const LONG_OUTCOME = 'Write the outcome in full. '.repeat(11).trim();
    const long = {
      ...HELLO_DOCUMENT,
      view: {
        name: 'hello',
        intent: { outcome: LONG_OUTCOME },
        stages: [{ name: LONG_NAME, agent: LONG_AGENT }],
      },
    };

    it('keeps the whole name, agent and harness in a title on the node', () => {
      render(<Designer result={loaded(long)} />);

      const node = screen.getByTestId(`node-stage-${LONG_NAME}`);
      expect(within(node).getByTitle(LONG_NAME)).toBeTruthy();
      expect(within(node).getByTitle(`${LONG_AGENT} · kiro-cli`)).toBeTruthy();
    });

    it('keeps the whole outcome in a title on the intent node', () => {
      render(<Designer result={loaded(long)} />);

      const intent = screen.getByTestId('node-intent');
      expect(within(intent).getByTitle(LONG_OUTCOME)).toBeTruthy();
    });

    it('shows the whole outcome under the graph', () => {
      render(<Designer result={loaded(long)} />);

      expect(screen.getByTestId('full-intent').textContent).toBe(
        `Intent: ${LONG_OUTCOME}`,
      );
    });

    it('shows the name, agent and harness of a clipped stage under the graph', () => {
      render(<Designer result={loaded(long)} />);

      expect(screen.getByTestId(`full-stage-${LONG_NAME}`).textContent).toBe(
        `Stage ${LONG_NAME}: ${LONG_AGENT} · kiro-cli`,
      );
    });

    it('shows an outcome of 60 Japanese characters, which fills the node twice over', () => {
      const outcome = '作'.repeat(60);
      const wide = {
        ...HELLO_DOCUMENT,
        view: { ...HELLO_VIEW, intent: { outcome } },
      };

      render(<Designer result={loaded(wide)} />);

      expect(screen.getByTestId('full-intent').textContent).toBe(
        `Intent: ${outcome}`,
      );
    });

    it('shows a stage name of 14 Japanese characters under the graph', () => {
      const name = '日本語の長いステージ名です';
      const wide = {
        ...HELLO_DOCUMENT,
        view: { ...HELLO_VIEW, stages: [{ name, agent: 'a' }] },
      };

      render(<Designer result={loaded(wide)} />);

      expect(screen.getByTestId(`full-stage-${name}`)).toBeTruthy();
    });

    it('shows no second copy of an outcome that fits the node', () => {
      render(<Designer result={loaded(HELLO_DOCUMENT)} />);

      expect(screen.queryByTestId('full-intent')).toBeNull();
      expect(screen.queryByTestId('full-text')).toBeNull();
    });
  });

  it('announces the loading state and the load error', () => {
    const { rerender } = render(<Designer result={undefined} />);
    expect(screen.getByRole('status').textContent).toContain('Loading');

    rerender(<Designer result={failed('The launch code is not valid.')} />);

    expect(screen.getByRole('alert').textContent).toContain(
      'The launch code is not valid.',
    );
  });

  it('draws a new canvas when the workflow is replaced, so it is fitted again', () => {
    const { rerender } = render(<Designer result={loaded(HELLO_DOCUMENT)} />);
    const before = screen.getByRole('region', { name: 'Workflow graph' });

    rerender(<Designer result={loaded(HELLO_DOCUMENT)} />);

    expect(screen.getByRole('region', { name: 'Workflow graph' })).not.toBe(
      before,
    );
  });

  it('keeps the canvas while the same result is drawn again', () => {
    const result = loaded(HELLO_DOCUMENT);
    const { rerender } = render(<Designer result={result} />);
    const before = screen.getByRole('region', { name: 'Workflow graph' });

    rerender(<Designer result={result} />);

    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBe(before);
  });
});
