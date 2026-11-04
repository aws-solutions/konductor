// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LaunchNotice } from './LaunchNotice';

function fakeSource() {
  let notice: string | undefined;
  const listeners = new Set<() => void>();
  const set = (next: string | undefined) => {
    notice = next;
    listeners.forEach((listener) => listener());
  };
  return {
    set,
    notice: () => notice,
    subscribeNotice: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismissNotice: () => set(undefined),
  };
}

describe('LaunchNotice', () => {
  it('shows nothing until a launch address is refused', () => {
    render(<LaunchNotice source={fakeSource()} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says that a refused launch address left the open workflow as it was', () => {
    const source = fakeSource();
    render(<LaunchNotice source={source} />);

    act(() => source.set('The launch code is not valid.'));

    expect(screen.getByRole('alert').textContent).toContain(
      'The launch code is not valid. The open workflow is unchanged.',
    );
  });

  it('goes away when it is dismissed', () => {
    const source = fakeSource();
    render(<LaunchNotice source={source} />);
    act(() => source.set('The launch code is not valid.'));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
