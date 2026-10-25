// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MODE_STORAGE_KEY } from './theme/mode';
import { App } from './App';
import { HELLO_DOCUMENT, failed, loaded } from './test-support/fixtures';
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
  document.body.classList.remove('awsui-dark-mode');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('App', () => {
  it('renders the page title inside a main landmark', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', {
        level: 1,
        name: 'Workflow canvas',
      }),
    ).toBeTruthy();
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

  it('shows a placeholder on the Execution tab', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    expect(
      screen.getByRole('tabpanel', { name: 'Execution' }).textContent,
    ).toContain('Nothing here yet.');
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

    expect(document.body.classList.contains('awsui-dark-mode')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('dark');
    expect(themeButton('dark').textContent).toBe('Theme: dark');

    fireEvent.click(themeButton('dark'));

    expect(document.body.classList.contains('awsui-dark-mode')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('light');
  });

  it('starts in the mode that was saved', () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, 'dark');

    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(document.body.classList.contains('awsui-dark-mode')).toBe(true);
    expect(themeButton('dark')).toBeTruthy();
  });

  it('does not save a mode that nobody chose', () => {
    render(<App load={settled(loaded(HELLO_DOCUMENT))} />);

    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
  });
});
