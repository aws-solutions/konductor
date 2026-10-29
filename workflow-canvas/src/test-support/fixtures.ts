// SPDX-License-Identifier: Apache-2.0
import type { Session, WorkflowDocument, WorkflowView } from '../api/types';
import type { LoadResult } from '../workflow/load-workflow';

/** The workflow that the stub serves: a draft stage, then a review stage. */
export const HELLO_VIEW: WorkflowView = {
  name: 'hello',
  intent: { outcome: 'Add a greeting to the README' },
  stages: [
    { name: 'draft', agent: 'k-developer' },
    { name: 'review', agent: 'k-quality-assurance' },
  ],
};

/** The session that the stub opens for the launch code. */
export const HELLO_SESSION: Session = {
  token: 'token-1',
  root: 'hello',
  harness: 'kiro-cli',
  apiVersion: 1,
};

/** The document that `GET /api/workflow` returns for the workflow above. */
export const HELLO_DOCUMENT: WorkflowDocument = {
  name: 'hello',
  text: 'name: hello\n',
  view: HELLO_VIEW,
  diagnostics: [],
};

/** A load that succeeded with the document. */
export function loaded(document: WorkflowDocument): LoadResult {
  return {
    ok: true,
    workflow: { harness: 'kiro-cli', document },
    remember: () => undefined,
  };
}

/** A load that failed with the message. */
export function failed(message: string): LoadResult {
  return { ok: false, message };
}
