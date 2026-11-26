// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODE_STORAGE_KEY } from './theme/mode';
import { App } from './App';
import { HELLO_DOCUMENT, failed, loaded } from './test-support/fixtures';
import { createSwapRisk } from './launch/swap-guard';
import { ApiError } from './api/api';
import { COPY_UNCERTAIN_CODE } from './next-ui/next-http';
import { fakeNextPorts } from './test-support/next-ports';
import type { LoadResult } from './workflow/load-workflow';

const settled = (result: LoadResult) => Promise.resolve(result);

const ports = () => fakeNextPorts();

// The top bar measures itself, and jsdom has no layout, so it shows its
// buttons in the overflow menu. The measuring copy is hidden from the
// accessibility tree, but it is the same button with the same handler.
const themeButton = (mode: 'light' | 'dark') =>
  screen.getAllByRole('button', {
    name: new RegExp(`^Theme: ${mode}`),
    hidden: true,
  })[0]!;

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('App', () => {
  it('shows "Workflow canvas" as the title until a workflow loads', () => {
    render(
      <App load={new Promise<LoadResult>(() => {})} nextPortsFor={ports} />,
    );

    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', {
        level: 1,
        name: 'Workflow canvas',
      }),
    ).toBeTruthy();
  });

  it('titles the page with the name of the loaded workflow', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    const main = screen.getByRole('main');
    expect(
      await within(main).findByRole('heading', { level: 1, name: 'hello' }),
    ).toBeTruthy();
  });

  it('keeps "Workflow canvas" as the title when the load failed', async () => {
    render(
      <App
        load={settled(failed('The launch code is not valid.'))}
        nextPortsFor={ports}
      />,
    );

    await screen.findByText('The launch code is not valid.');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Workflow canvas' }),
    ).toBeTruthy();
  });

  it('moves between the views with the arrow keys, Home and End', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);
    const designer = screen.getByRole('tab', { name: 'Design' });
    const execution = screen.getByRole('tab', { name: 'Run' });
    const library = screen.getByRole('tab', { name: 'Library' });
    designer.focus();

    fireEvent.keyDown(designer, { key: 'ArrowRight' });
    expect(execution.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(execution);
    expect(screen.getByRole('tabpanel', { name: 'Run' })).toBeTruthy();

    fireEvent.keyDown(execution, { key: 'ArrowRight' });
    expect(library.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(library);

    fireEvent.keyDown(library, { key: 'ArrowRight' });
    expect(designer.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(designer);

    fireEvent.keyDown(designer, { key: 'End' });
    expect(library.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(library, { key: 'Home' });
    expect(designer.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(designer, { key: 'ArrowLeft' });
    expect(library.getAttribute('aria-selected')).toBe('true');
  });

  it('announces nothing while the workflow is loading', () => {
    render(
      <App load={new Promise<LoadResult>(() => {})} nextPortsFor={ports} />,
    );

    expect(screen.getByTestId('run-live-status').textContent).toBe('');
  });

  it('announces nothing to run when the load failed', async () => {
    render(
      <App
        load={settled(failed('The launch code is not valid.'))}
        nextPortsFor={ports}
      />,
    );

    await screen.findByText('The launch code is not valid.');
    expect(screen.getByTestId('run-live-status').textContent).toBe('');
  });

  it('announces nothing before a run is started', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);
    await screen.findByTestId('node-stage-draft');

    expect(screen.getByTestId('run-live-status').textContent).toBe('');
  });

  it.each([
    {
      when: 'the workflow file is missing',
      document: { ...HELLO_DOCUMENT, text: null, hash: null, view: null },
      shown: 'The workflow has no file yet.',
    },
    {
      when: 'the workflow file is not valid',
      document: {
        ...HELLO_DOCUMENT,
        text: 'format: nope\n',
        view: null,
        diagnostics: [
          {
            message: 'The format is not known.',
            line: 1,
            path: 'format',
            severity: 'error' as const,
          },
        ],
      },
      shown: 'The format is not known.',
    },
  ])('announces nothing to run when $when', async ({ document, shown }) => {
    render(<App load={settled(loaded(document))} nextPortsFor={ports} />);

    await screen.findByText(shown, { exact: false });
    expect(screen.getByTestId('run-live-status').textContent).toBe('');
  });

  it.each([
    {
      when: 'the root file is missing',
      document: { ...HELLO_DOCUMENT, text: null, hash: null, view: null },
    },
    {
      when: 'the root file is invalid',
      document: {
        ...HELLO_DOCUMENT,
        text: 'format: nope\n',
        view: null,
        diagnostics: [
          {
            message: 'The format is not known.',
            line: 1,
            path: 'format',
            severity: 'error' as const,
          },
        ],
      },
    },
  ])('opens Library when $when', async ({ document }) => {
    const next = fakeNextPorts({
      listLibrary: async () => [
        {
          name: 'library/k-adversarial-pull-request-review',
          title: 'Adversarial pull request review',
          summary: 'Review a pull request.',
          status: 'ready',
        },
      ],
    });
    render(<App load={settled(loaded(document))} nextPortsFor={() => next} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));

    expect(
      await screen.findByText('Adversarial pull request review'),
    ).toBeTruthy();
  });

  it('lets Tab reach only the selected view in the switch', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    expect(
      screen.getByRole('tab', { name: 'Design' }).getAttribute('tabindex'),
    ).toBe('0');
    expect(
      screen.getByRole('tab', { name: 'Run' }).getAttribute('tabindex'),
    ).toBe('-1');
  });

  it('renders the Design and Run views with Design selected', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    expect(
      screen.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Run' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('shows that the workflow is loading until the load settles', async () => {
    let finish: (result: LoadResult) => void = () => {};
    const pending = new Promise<LoadResult>((resolve) => {
      finish = resolve;
    });
    render(<App load={pending} nextPortsFor={ports} />);
    expect(screen.getByText('Loading the workflow')).toBeTruthy();

    finish(loaded(HELLO_DOCUMENT));

    expect(await screen.findByTestId('node-stage-draft')).toBeTruthy();
    expect(screen.queryByText('Loading the workflow')).toBeNull();
  });

  it('draws the workflow on the Design view', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    expect(await screen.findByTestId('node-stage-draft')).toBeTruthy();
  });

  it('shows the error on the Design view when the load failed', async () => {
    render(
      <App
        load={settled(failed('The launch code is not valid.'))}
        nextPortsFor={ports}
      />,
    );

    expect(
      await screen.findByText('The launch code is not valid.'),
    ).toBeTruthy();
  });

  it('offers the Goal box and Run on the Run view', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);
    await screen.findByTestId('node-stage-draft');

    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));

    const panel = screen.getByRole('tabpanel', { name: 'Run' });
    expect(
      await within(panel).findByRole('button', { name: 'Run' }),
    ).toBeTruthy();
    expect(within(panel).getByLabelText('Goal')).toBeTruthy();
  });

  it('opens a library copy in Design as an editable workflow', async () => {
    const copy = {
      ...HELLO_DOCUMENT,
      name: 'review-copy',
      text:
        HELLO_DOCUMENT.text?.replace('name: hello', 'name: review-copy') ??
        null,
      view: HELLO_DOCUMENT.view && {
        ...HELLO_DOCUMENT.view,
        name: 'review-copy',
      },
    };
    const next = fakeNextPorts({
      listLibrary: async () => [
        {
          name: 'library/k-adversarial-pull-request-review',
          title: 'Adversarial pull request review',
          summary: 'Review a pull request.',
          status: 'ready',
        },
      ],
      copyLibrary: async () => copy,
    });
    render(
      <App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={() => next} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start from Adversarial pull request review',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'review-copy' }),
    ).toBeTruthy();
    const designTab = screen.getByRole('tab', { name: 'Design' });
    expect(designTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(designTab);
    expect(screen.getByTestId('yaml-text').hasAttribute('readonly')).toBe(
      false,
    );
  });

  it('drops the old run, history, and check source after copying', async () => {
    let root = 'hello';
    let remembered: string | undefined = '20261024-0412-a7b3c';
    const runMemory = {
      recall: () => remembered,
      remember: (runId: string) => {
        remembered = runId;
      },
      forget: () => {
        remembered = undefined;
      },
    };
    const validate = vi.fn(async (request: { name?: string; text: string }) => {
      void request;
      return {
        errors: 0,
        warnings: 0,
        infos: 0,
        view: null,
        diagnostics: [],
      };
    });
    const copy = {
      ...HELLO_DOCUMENT,
      name: 'review-copy',
      view: HELLO_DOCUMENT.view && {
        ...HELLO_DOCUMENT.view,
        name: 'review-copy',
      },
    };
    const next = fakeNextPorts({
      validate,
      listLibrary: async () => [
        {
          name: 'library/k-adversarial-pull-request-review',
          title: 'Adversarial pull request review',
          summary: 'Review a pull request.',
          status: 'ready',
        },
      ],
      listRuns: async () =>
        root === 'hello'
          ? [
              {
                run_id: '20261024-0412-a7b3c',
                started_at: '2026-10-24T04:12:05Z',
                status: 'running',
                goal: 'Old goal',
                goal_truncated: false,
              },
            ]
          : [],
      copyLibrary: async () => {
        root = 'review-copy';
        return copy;
      },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <App
        load={settled(loaded(HELLO_DOCUMENT))}
        runMemory={runMemory}
        nextPortsFor={() => next}
      />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start from Adversarial pull request review',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));
    await screen.findByRole('heading', { level: 1, name: 'review-copy' });
    expect(screen.getByTestId('run-live-status').textContent).toBe(
      'k-adversarial-pull-request-review-copy created and opened.',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));

    expect(await screen.findByText('No run yet.')).toBeTruthy();
    expect(screen.queryByTestId('run-history-row')).toBeNull();
    expect(remembered).toBeUndefined();
    expect(validate.mock.calls.map(([request]) => request.name)).toContain(
      'review-copy',
    );
    confirm.mockRestore();
  });

  it('blocks edits and runs when a committed copy cannot be reconciled', async () => {
    const uncertain = new ApiError(
      'Reload the page before editing or running anything.',
      200,
      COPY_UNCERTAIN_CODE,
    );
    const next = fakeNextPorts({
      listLibrary: async () => [
        {
          name: 'library/k-adversarial-pull-request-review',
          title: 'Adversarial pull request review',
          summary: 'Review a pull request.',
          status: 'ready',
        },
      ],
      copyLibrary: async () => Promise.reject(uncertain),
    });
    render(
      <App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={() => next} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start from Adversarial pull request review',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect((await screen.findByText(uncertain.message)).textContent).toBe(
      uncertain.message,
    );
    expect(screen.queryByTestId('yaml-text')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
    expect(screen.queryByLabelText('Goal')).toBeNull();
  });

  it('says a run uses the saved workflow when Design has unsaved changes', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);
    await screen.findByTestId('node-stage-draft');
    fireEvent.change(screen.getByTestId('yaml-text'), {
      target: { value: 'name: hello\n' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));

    expect(screen.getByTestId('unsaved-note').textContent).toContain(
      'A run uses the saved workflow',
    );
  });

  it('keeps the loaded workflow when the views are switched back and forth', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);
    await screen.findByTestId('node-stage-draft');

    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

    expect(screen.getByTestId('node-stage-draft')).toBeTruthy();
    expect(screen.queryByText('Loading the workflow')).toBeNull();
  });

  it('shows the top bar with the page name and a theme button', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    expect(themeButton('light').textContent).toBe('Theme: light');
    expect(themeButton('light').getAttribute('aria-label')).toBe(
      'Theme: light. Switch to dark',
    );
  });

  it('shows the breadcrumb Workflows > the open workflow, with no dead link', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    const trail = await screen.findByRole('navigation', {
      name: 'Breadcrumbs',
    });
    expect(within(trail).getByText('Workflows')).toBeTruthy();
    expect(
      (await within(trail).findByText('hello')).closest('[aria-current]'),
    ).toBeTruthy();
    expect(within(trail).queryAllByRole('link')).toEqual([]);
  });

  it('switches to the dark mode, remembers it and switches back', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    fireEvent.click(themeButton('light'));

    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('dark');
    expect(themeButton('dark').textContent).toBe('Theme: dark');

    fireEvent.click(themeButton('dark'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(themeButton('light').textContent).toBe('Theme: light');
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('light');
  });

  it('starts in the mode that was saved', () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, 'dark');

    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeButton('dark').textContent).toBe('Theme: dark');
  });

  it('does not save a mode that nobody chose', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} nextPortsFor={ports} />);

    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
  });
});

describe('App and the risk of opening another workflow', () => {
  it('has nothing at risk before anything is changed or run', async () => {
    const swapRisk = createSwapRisk();
    render(
      <App
        load={settled(loaded(HELLO_DOCUMENT))}
        swapRisk={swapRisk}
        nextPortsFor={ports}
      />,
    );
    await screen.findByTestId('node-stage-draft');

    expect(swapRisk.get()).toEqual({ draft: false, run: false });
  });

  it('reports unsaved changes in the Design view', async () => {
    const swapRisk = createSwapRisk();
    render(
      <App
        load={settled(loaded(HELLO_DOCUMENT))}
        swapRisk={swapRisk}
        nextPortsFor={ports}
      />,
    );
    await screen.findByTestId('node-stage-draft');

    fireEvent.change(screen.getByTestId('yaml-text'), {
      target: { value: 'name: hello\n' },
    });

    expect(swapRisk.get()).toEqual({ draft: true, run: false });
  });
});
