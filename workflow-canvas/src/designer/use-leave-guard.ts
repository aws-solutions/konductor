// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react';

// The browser asks "Leave site?" when a `beforeunload` handler cancels the
// event. Older browsers also need a return value; the text is not shown.
function confirmLeaving(event: Event): void {
  event.preventDefault();
  (event as BeforeUnloadEvent).returnValue = '';
}

/**
 * While `dirty`, makes the browser ask before the page is closed or
 * reloaded, because the changes live in the page only. `target` is the
 * window in a browser.
 */
export function useLeaveGuard(dirty: boolean, target: EventTarget): void {
  useEffect(() => {
    if (!dirty) return;
    target.addEventListener('beforeunload', confirmLeaving);
    return () => target.removeEventListener('beforeunload', confirmLeaving);
  }, [dirty, target]);
}
