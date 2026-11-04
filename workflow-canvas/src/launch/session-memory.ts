// SPDX-License-Identifier: Apache-2.0

/** The key under which the session of the tab is kept in session storage. */
export const SESSION_KEY = 'konductor-workflow-canvas-session';

/** The key of the session that a pasted launch code opened but did not show yet. */
export const PENDING_KEY = 'konductor-workflow-canvas-pending-session';

/** What the page needs to open the workflow again: the token and the harness. */
export interface SessionRecord {
  token: string;
  harness: string;
}

/**
 * The port through which the page keeps its session across a reload. The
 * launch code is never kept, only what the session returned. The pending
 * session is one that a pasted code opened while another was kept: a reload
 * tries it first, and `remember` replaces the kept session with it.
 */
export interface SessionMemory {
  recall(): SessionRecord | undefined;
  remember(record: SessionRecord): void;
  forget(): void;
  recallPending(): SessionRecord | undefined;
  holdPending(record: SessionRecord): void;
  dropPending(): void;
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
 * Keeps the session in the `sessionStorage` of the tab. It survives a reload,
 * is copied into a tab made by Duplicate or `window.open`, and a browser may
 * restore it with the tab. Script on the page can read it. A browser that
 * blocks storage leaves the page with no memory.
 */
export function sessionStorageMemory(
  env: SessionMemoryEnvironment,
): SessionMemory {
  const read = (key: string) => {
    try {
      return parse(env.sessionStorage?.getItem(key));
    } catch {
      return undefined;
    }
  };
  const write = ({ token, harness }: SessionRecord, key: string) => {
    try {
      env.sessionStorage?.setItem(key, JSON.stringify({ token, harness }));
    } catch {
      // Without storage a reload needs a new launch address.
    }
  };
  const remove = (key: string) => {
    try {
      env.sessionStorage?.removeItem(key);
    } catch {
      // Without storage there is nothing to forget.
    }
  };
  return {
    recall: () => read(SESSION_KEY),
    remember(record) {
      if (read(SESSION_KEY)?.token === record.token) return;
      write(record, SESSION_KEY);
      remove(PENDING_KEY);
    },
    forget: () => remove(SESSION_KEY),
    recallPending: () => read(PENDING_KEY),
    holdPending: (record) => write(record, PENDING_KEY),
    dropPending: () => remove(PENDING_KEY),
  };
}
