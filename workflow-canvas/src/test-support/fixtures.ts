// SPDX-License-Identifier: Apache-2.0
import type {
  RunView,
  Session,
  StageFields,
  StageView,
  WorkflowDocument,
  WorkflowView,
} from '../api/types';
import type { EditPort } from '../designer/core';
import type { RunPort } from '../execution/core';
import type { LoadResult } from '../workflow/load-workflow';

/**
 * A stage as the server sends it. The lines are one place-holder line: the
 * tests that use this do not read them.
 */
export function stageViewOf(name: string, agent: string): StageView {
  return { name, kind: 'agent', agent, range: { line: 1, end_line: 1 } };
}

/** The workflow that the stub serves: a draft stage, then a review stage. */
export const HELLO_VIEW: WorkflowView = {
  name: 'hello',
  intent: {
    outcome: 'Add a greeting to the README',
    accept: [{ id: 'readme-exists', file: 'README.md' }],
  },
  params: {
    goal: {
      description: 'What the workflow should accomplish.',
      default: 'Add a greeting to the README',
    },
  },
  stages: [
    {
      name: 'draft',
      kind: 'agent',
      agent: 'k-developer',
      range: { line: 14, end_line: 16 },
    },
    {
      name: 'review',
      kind: 'agent',
      agent: 'k-quality-assurance',
      range: { line: 17, end_line: 19 },
    },
  ],
};

/** The session that the stub opens for the launch code. */
export const HELLO_SESSION: Session = {
  token: 'token-1',
  root: 'hello',
  harness: 'kiro-cli',
  apiVersion: 1,
};

/**
 * The text of the file behind the workflow above, in the first-release format:
 * every slice 1 key, and stages with a `prompt` and a `prompt_file`.
 */
export const HELLO_TEXT = [
  'format: konductor/1',
  'name: hello',
  'version: 0.1.0',
  'intent:',
  '  outcome: Add a greeting to the README',
  '  accept:',
  '    - id: readme-exists',
  '      file: README.md',
  'params:',
  '  goal:',
  '    description: What the workflow should accomplish.',
  '    default: Add a greeting to the README',
  'stages:',
  '  - name: draft',
  '    agent: k-developer',
  '    prompt: Write the greeting to README.md.',
  '  - name: review',
  '    agent: k-quality-assurance',
  '    prompt_file: review.md',
  '',
].join('\n');

/** The hash that the server gives that text; a test only needs it to differ. */
export const HELLO_HASH = 'a'.repeat(64);

/** The keys of a stage that a client may edit, as the stub serves them. */
export const HELLO_STAGE_FIELDS: StageFields = {
  agent: [
    {
      key: 'name',
      type: 'name',
      required: true,
      max_length: 64,
      pattern: '^[a-z0-9][a-z0-9-]{0,63}$',
      reserved: ['start', 'end', 'run', 'halt'],
    },
    {
      key: 'agent',
      type: 'name',
      required: true,
      max_length: 64,
      pattern: '^[a-z0-9][a-z0-9-]{0,63}$',
    },
    {
      key: 'prompt',
      type: 'text',
      required: false,
      min_length: 1,
      max_length: 32768,
      excludes: ['prompt_file'],
    },
    { key: 'prompt_file', type: 'path', required: false, excludes: ['prompt'] },
  ],
};

/** The document that `GET /api/workflow` returns for the workflow above. */
export const HELLO_DOCUMENT: WorkflowDocument = {
  name: 'hello',
  text: HELLO_TEXT,
  hash: HELLO_HASH,
  readOnly: false,
  view: HELLO_VIEW,
  diagnostics: [],
  stageFields: HELLO_STAGE_FIELDS,
};

/** Run calls that are never used, for a test that does not run anything. */
export const NO_RUNS: RunPort = {
  start: () => Promise.reject(new Error('This test starts no run.')),
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
    remember: () => undefined,
  };
}

const HELLO_STAGES = HELLO_VIEW.stages.map((stage) => stage.name);

/**
 * The state of a run of the workflow above: stages before `at` have passed,
 * the one at `at` runs and the ones after it wait. An `at` past the last
 * stage is a run that passed. With `blockedAt`, that stage failed instead
 * and the run halted, for `reason` (`RESULT_MISSING` unless it is given).
 */
export function helloRun(
  at: number,
  {
    blockedAt,
    reason = 'RESULT_MISSING',
  }: { blockedAt?: number; reason?: string } = {},
): RunView {
  const halted = blockedAt !== undefined;
  const finished = halted || at >= HELLO_STAGES.length;
  return {
    runId: '20261024-0412-a7b3c',
    harness: 'kiro-cli',
    status: halted ? 'halted' : finished ? 'passed' : 'running',
    exitCode: halted ? 1 : finished ? 0 : null,
    stages: HELLO_STAGES.map((name, index) =>
      index === blockedAt
        ? { name, status: 'blocked', reason }
        : {
            name,
            status:
              index < (blockedAt ?? at)
                ? 'passed'
                : index === at && !halted
                  ? 'running'
                  : 'pending',
          },
    ),
  };
}

/** A load that failed with the message. */
export function failed(message: string): LoadResult {
  return { ok: false, message };
}
