// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { HELLO_DOCUMENT, failed, loaded } from './test-support/fixtures';
import type { LoadResult } from './workflow/load-workflow';

const settled = (result: LoadResult) => Promise.resolve(result);

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
});
