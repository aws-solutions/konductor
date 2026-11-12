// SPDX-License-Identifier: Apache-2.0
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODE_STORAGE_KEY } from './theme/mode';
import { App } from './App';
import { FakeScheduler } from './test-support/fake-scheduler';
import {
  HELLO_DOCUMENT,
  failed,
  helloRun,
  loaded,
} from './test-support/fixtures';
import { createSwapRisk } from './launch/swap-guard';
import type { LoadResult } from './workflow/load-workflow';

const settled = (result: LoadResult) => Promise.resolve(result);

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
    render(<App load={new Promise<LoadResult>(() => {})} />);

    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', {
        level: 1,
        name: 'Workflow canvas',
      }),
    ).toBeTruthy();
  });

  it('titles the page with the name of the loaded workflow', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    const main = screen.getByRole('main');
    expect(
      await within(main).findByRole('heading', { level: 1, name: 'hello' }),
    ).toBeTruthy();
  });

  it('keeps "Workflow canvas" as the title when the load failed', async () => {
    render(<App load={settled(failed('The launch code is not valid.'))} />);

    await screen.findByText('The launch code is not valid.');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Workflow canvas' }),
    ).toBeTruthy();
  });

  it('moves between the views with the arrow keys, Home and End', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);
    const designer = screen.getByRole('tab', { name: 'Designer' });
    const execution = screen.getByRole('tab', { name: 'Execution' });
    designer.focus();

    fireEvent.keyDown(designer, { key: 'ArrowRight' });
    expect(execution.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(execution);
    expect(screen.getByRole('tabpanel', { name: 'Execution' })).toBeTruthy();

    fireEvent.keyDown(execution, { key: 'ArrowRight' });
    expect(designer.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(designer);

    fireEvent.keyDown(designer, { key: 'End' });
    expect(execution.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(execution, { key: 'Home' });
    expect(designer.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(designer, { key: 'ArrowLeft' });
    expect(execution.getAttribute('aria-selected')).toBe('true');
  });

  it('lets Tab reach only the selected view in the switch', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(
      screen.getByRole('tab', { name: 'Designer' }).getAttribute('tabindex'),
    ).toBe('0');
    expect(
      screen.getByRole('tab', { name: 'Execution' }).getAttribute('tabindex'),
    ).toBe('-1');
  });

  it('renders the Designer and Execution tabs with Designer selected', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(
      screen
        .getByRole('tab', { name: 'Designer' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen
        .getByRole('tab', { name: 'Execution' })
        .getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('shows that the workflow is loading until the load settles', async () => {
    let finish: (result: LoadResult) => void = () => {};
    const pending = new Promise<LoadResult>((resolve) => {
      finish = resolve;
    });
    render(<App load={pending} />);
    expect(screen.getByText('Loading the workflow')).toBeTruthy();

    finish(loaded(HELLO_DOCUMENT));

    expect(await screen.findByTestId('node-stage-draft')).toBeTruthy();
    expect(screen.queryByText('Loading the workflow')).toBeNull();
  });

  it('draws the workflow on the Designer tab', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(await screen.findByTestId('node-stage-draft')).toBeTruthy();
  });

  it('shows the error on the Designer tab when the load failed', async () => {
    render(<App load={settled(failed('The launch code is not valid.'))} />);

    expect(
      await screen.findByText('The launch code is not valid.'),
    ).toBeTruthy();
  });

  it('draws the workflow with a Run button on the Execution tab', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    const panel = screen.getByRole('tabpanel', { name: 'Execution' });
    expect(await within(panel).findByTestId('node-stage-draft')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Run' })).toBeTruthy();
  });

  it('keeps the loaded workflow when the tabs are switched back and forth', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);
    await screen.findByTestId('node-end');

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Designer' }));

    expect(screen.getByTestId('node-end')).toBeTruthy();
    expect(screen.queryByText('Loading the workflow')).toBeNull();
  });

  it('shows the top bar with the page name and a theme button', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(themeButton('light').textContent).toBe('Theme: light');
    expect(themeButton('light').getAttribute('aria-label')).toBe(
      'Theme: light. Switch to dark',
    );
  });

  it('shows the breadcrumb Workflows > the open workflow, with no dead link', async () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

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
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

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

    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeButton('dark').textContent).toBe('Theme: dark');
  });

  it('does not save a mode that nobody chose', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
  });
});

describe('App and the risk of opening another workflow', () => {
  it('has nothing at risk before anything is changed or run', async () => {
    const swapRisk = createSwapRisk();
    render(<App load={settled(loaded(HELLO_DOCUMENT))} swapRisk={swapRisk} />);
    await screen.findByTestId('node-end');

    expect(swapRisk.get()).toEqual({ draft: false, run: false });
  });

  it('reports unsaved changes in the Designer', async () => {
    const swapRisk = createSwapRisk();
    render(<App load={settled(loaded(HELLO_DOCUMENT))} swapRisk={swapRisk} />);
    await screen.findByTestId('node-end');

    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
      target: { value: 'write' },
    });

    expect(swapRisk.get()).toEqual({ draft: true, run: false });
  });

  it('reports a run that is being followed', async () => {
    const swapRisk = createSwapRisk();
    const runs = {
      start: vi.fn().mockResolvedValue(helloRun(0).runId),
      get: vi.fn().mockResolvedValue(helloRun(0)),
    };
    render(
      <App
        load={settled(loaded(HELLO_DOCUMENT, runs))}
        scheduler={new FakeScheduler()}
        swapRisk={swapRisk}
      />,
    );
    await screen.findByTestId('node-end');
    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(swapRisk.get()).toEqual({ draft: false, run: true }),
    );
  });
});
