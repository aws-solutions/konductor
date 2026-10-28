// SPDX-License-Identifier: Apache-2.0

/** The key under which the session of the tab is kept in session storage. */
export const SESSION_KEY = 'konductor-workflow-canvas-session';

/** What the page needs to open the workflow again: the token and the harness. */
export interface SessionRecord {
  token: string;
  harness: string;
}

/**
 * The port through which the page keeps its session across a reload. The
 * launch code is never kept, only what the session returned.
 */
export interface SessionMemory {
  recall(): SessionRecord | undefined;
  remember(record: SessionRecord): void;
  forget(): void;
}

/** The part of `window` that the memory of a session needs. */
export interface SessionMemoryEnvironment {
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

function isRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const { token, harness } = value as Record<string, unknown>;
  return (
    typeof token === 'string' && token !== '' && typeof harness === 'string'
  );
}

function parse(text: string | null | undefined): SessionRecord | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps the session in the storage of the browser tab: it is gone when the
 * tab closes. Script on the page can read it. A browser that blocks storage
 * leaves the page with no memory.
 */
export function sessionStorageMemory(
  env: SessionMemoryEnvironment,
): SessionMemory {
  return {
    recall() {
      try {
        return parse(env.sessionStorage?.getItem(SESSION_KEY));
      } catch {
        return undefined;
      }
    },
    remember({ token, harness }) {
      try {
        env.sessionStorage?.setItem(
          SESSION_KEY,
          JSON.stringify({ token, harness }),
        );
      } catch {
        // Without storage a reload needs a new launch address.
      }
    },
    forget() {
      try {
        env.sessionStorage?.removeItem(SESSION_KEY);
      } catch {
        // Without storage there is nothing to forget.
      }
    },
  };
}
