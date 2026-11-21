// SPDX-License-Identifier: Apache-2.0
import type { WorkflowApi } from '../api/api';

/**
 * A workflow API that remembers the token of the last workflow it loaded,
 * and the calls of the views being built, which the page builds for that
 * workflow.
 */
export interface SessionTap {
  /** Give this to the loader in place of the API it was going to use. */
  readonly api: WorkflowApi;
  /**
   * The token the workflow now on the page was loaded with, or `undefined`
   * before one has loaded. A load that failed leaves the one before it, so
   * the calls of the views address the workflow a person can see.
   */
  loadedToken(): string | undefined;
}

/**
 * Wraps `api` and records the token of each `getWorkflow` that answered, so
 * the page can build the calls of the new views for the workflow it shows.
 * Nothing else is recorded, and the token never leaves this module except
 * through `loadedToken`.
 *
 * The loader keeps the token of a session to itself, and the new views need
 * one of their own until the API client carries their calls. Reading it as a
 * workflow loads keeps the two in step: a pasted address that fails to load
 * does not move it, so no call of the views goes to a session whose workflow
 * is not on the page.
 */
export function tapSessions(api: WorkflowApi): SessionTap {
  let loaded: string | undefined;
  return {
    api: {
      ...api,
      getWorkflow: async (token) => {
        const document = await api.getWorkflow(token);
        loaded = token;
        return document;
      },
    },
    loadedToken: () => loaded,
  };
}
