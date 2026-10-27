// SPDX-License-Identifier: Apache-2.0
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLeaveGuard } from './use-leave-guard';

// What the browser sends before it closes or reloads the page.
function leave(target: EventTarget): Event {
  const event = new Event('beforeunload', { cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('useLeaveGuard', () => {
  it('asks the browser to confirm leaving while there are changes', () => {
    const target = new EventTarget();
    renderHook(() => useLeaveGuard(true, target));

    expect(leave(target).defaultPrevented).toBe(true);
  });

  it('lets the page go when there are no changes', () => {
    const target = new EventTarget();
    renderHook(() => useLeaveGuard(false, target));

    expect(leave(target).defaultPrevented).toBe(false);
  });

  it('stops asking once the changes are gone', () => {
    const target = new EventTarget();
    const { rerender } = renderHook(
      ({ dirty }) => useLeaveGuard(dirty, target),
      { initialProps: { dirty: true } },
    );

    rerender({ dirty: false });

    expect(leave(target).defaultPrevented).toBe(false);
  });

  it('stops asking when the page is gone from the screen', () => {
    const target = new EventTarget();
    const { unmount } = renderHook(() => useLeaveGuard(true, target));

    unmount();

    expect(leave(target).defaultPrevented).toBe(false);
  });
});
