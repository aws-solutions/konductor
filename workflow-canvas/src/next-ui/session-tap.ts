// SPDX-License-Identifier: Apache-2.0
import type { WorkflowApi } from '../api/api';
import type { WorkflowDocument } from '../api/types';

/**
 * A workflow API that ties the token of each load to the workflow it loaded,
 * so the page can build the calls of the newer views for the workflow
 * it shows.
 */
export interface SessionTap {
  /** Give this to the loader in place of the API it was going to use. */
  readonly api: WorkflowApi;
  /**
   * The token that `document` was loaded with, or `undefined` for a document
   * this tap did not read, such as the one a save answers with.
   */
  tokenOf(document: WorkflowDocument): string | undefined;
}

/**
 * Wraps `api` and remembers, for each workflow it reads, the token it was
 * read with. Nothing else is recorded, and a token never leaves this module
 * except through `tokenOf`, for the very document it belongs to.
 *
 * The loader keeps the token of a session to itself, and the new views need
 * one of their own until the API client carries their calls. Tying it to the
 * document keeps the two in step whichever load wins: the page offers more
 * than one workflow at a time, and the one it shows is the newest that
 * answered, not the last one to finish. A tap that recorded each load as it
 * answered would hand out the token of an older workflow that finished after
 * the one on the page, and every call of the views would address it.
 *
 * The documents are held weakly, so a load the page dropped is collected
 * with its token.
 */
export function tapSessions(api: WorkflowApi): SessionTap {
  const tokens = new WeakMap<WorkflowDocument, string>();
  return {
    api: {
      ...api,
      getWorkflow: async (token) => {
        const document = await api.getWorkflow(token);
        tokens.set(document, token);
        return document;
      },
    },
    tokenOf: (document) => tokens.get(document),
  };
}
