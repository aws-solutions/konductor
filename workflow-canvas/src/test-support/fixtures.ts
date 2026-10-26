// SPDX-License-Identifier: Apache-2.0
import type {
  RunView,
  Session,
  WorkflowDocument,
  WorkflowView,
} from '../api/types';
import type { EditPort } from '../designer/core';
import type { RunPort } from '../execution/core';
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

/** The text of the file behind the workflow above. */
export const HELLO_TEXT =
  'name: hello\nintent: Add a greeting to the README\nstages:\n  - name: draft\n    agent: k-developer\n  - name: review\n    agent: k-quality-assurance\n';

/** The hash that the server gives that text; a test only needs it to differ. */
export const HELLO_HASH = 'a'.repeat(64);

/** The document that `GET /api/workflow` returns for the workflow above. */
export const HELLO_DOCUMENT: WorkflowDocument = {
  name: 'hello',
  text: HELLO_TEXT,
  hash: HELLO_HASH,
  view: HELLO_VIEW,
  diagnostics: [],
};

/** Run calls that are never used, for a test that does not run anything. */
export const NO_RUNS: RunPort = {
  start: () => Promise.reject(new Error('This test starts no run.')),
  get: () => Promise.reject(new Error('This test reads no run.')),
};

/** Edit calls that are never used, for a test that edits nothing. */
export const NO_EDITS: EditPort = {
  save: () => Promise.reject(new Error('This test saves nothing.')),
  check: () => Promise.reject(new Error('This test checks nothing.')),
  reload: () => Promise.reject(new Error('This test loads nothing again.')),
};

/** A load that succeeded with the document. */
export function loaded(
  document: WorkflowDocument,
  runs: RunPort = NO_RUNS,
  edits: EditPort = NO_EDITS,
): LoadResult {
  return {
    ok: true,
    workflow: { harness: 'kiro-cli', document, edits, runs },
  };
}

const HELLO_STAGES = HELLO_VIEW.stages.map((stage) => stage.name);

/**
 * The state of a run of the workflow above: stages before `at` have passed,
 * the one at `at` runs and the ones after it wait. An `at` past the last
 * stage is a run that passed. With `blockedAt`, that stage failed instead
 * and the run halted.
 */
export function helloRun(
  at: number,
  { blockedAt }: { blockedAt?: number } = {},
): RunView {
  const halted = blockedAt !== undefined;
  const finished = halted || at >= HELLO_STAGES.length;
  return {
    runId: '20261024-0412-a7b3c',
    status: halted ? 'halted' : finished ? 'passed' : 'running',
    exitCode: halted ? 1 : finished ? 0 : null,
    stages: HELLO_STAGES.map((name, index) => ({
      name,
      status:
        index === blockedAt
          ? 'blocked'
          : index < (blockedAt ?? at)
            ? 'passed'
            : index === at && !halted
              ? 'running'
              : 'pending',
    })),
  };
}

/** A load that failed with the message. */
export function failed(message: string): LoadResult {
  return { ok: false, message };
}
