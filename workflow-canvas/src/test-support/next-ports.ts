// SPDX-License-Identifier: Apache-2.0
import { vi } from 'vitest';
import type { WorkflowExtras } from '../api/workflow-extras';
import type { NextPorts } from '../next-ui/next-http';

/** The extras of the sample workflow: the keys of a stage and its goal. */
export const FAKE_EXTRAS: WorkflowExtras = {
  stageFields: {
    agent: [
      { key: 'name', type: 'name', required: true },
      { key: 'agent', type: 'name', required: true },
    ],
  },
  goalDefault: 'Add a greeting to the README',
};

/**
 * The calls the views make beyond the session's own, answered at once. The
 * read of the run events never settles, so a follower reads only what a test
 * answers. Pass `over` to change one call.
 */
export function fakeNextPorts(over: Partial<NextPorts> = {}): NextPorts {
  return {
    loadExtras: vi.fn(() => Promise.resolve(FAKE_EXTRAS)),
    listAgents: vi.fn(() =>
      Promise.resolve([{ id: 'k-developer', summary: 'Code' }]),
    ),
    listLibrary: vi.fn(() => Promise.resolve([])),
    getLibrary: vi.fn(() => Promise.reject(new Error('No library entry.'))),
    copyLibrary: vi.fn(() => Promise.reject(new Error('No library copy.'))),
    listRuns: vi.fn(() => Promise.resolve([])),
    startRun: vi.fn(() => Promise.resolve('20261024-0412-a7b3c')),
    readChecks: vi.fn(() => Promise.resolve({})),
    readEvents: vi.fn(
      () => new Promise<never>(() => undefined),
    ) as unknown as NextPorts['readEvents'],
    validate: vi.fn(() =>
      Promise.resolve({
        errors: 0,
        warnings: 0,
        infos: 0,
        view: null,
        diagnostics: [],
      }),
    ),
    ...over,
  };
}
