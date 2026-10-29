// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { helloRun } from '../../test-support/fixtures';
import { nodeStatuses } from './node-statuses';

function labels(run: Parameters<typeof nodeStatuses>[0]) {
  return [...nodeStatuses(run)].map(([id, { state, label }]) => [
    id,
    state,
    label,
  ]);
}

describe('nodeStatuses', () => {
  it('gives no node a status without a run', () => {
    expect(nodeStatuses(undefined).size).toBe(0);
  });

  it('has the intent done, the first stage running, the rest and the end queued', () => {
    expect(labels(helloRun(0))).toEqual([
      ['intent', 'done', 'Done'],
      ['stage-draft', 'running', 'Running'],
      ['stage-review', 'queued', 'Queued'],
      ['end', 'queued', 'Queued'],
    ]);
  });

  it('moves on to the next stage once the first has passed', () => {
    expect(labels(helloRun(1))).toEqual([
      ['intent', 'done', 'Done'],
      ['stage-draft', 'done', 'Done'],
      ['stage-review', 'running', 'Running'],
      ['end', 'queued', 'Queued'],
    ]);
  });

  it('shows the end as passed when every stage passed', () => {
    expect(labels(helloRun(2))).toEqual([
      ['intent', 'done', 'Done'],
      ['stage-draft', 'done', 'Done'],
      ['stage-review', 'done', 'Done'],
      ['end', 'done', 'Passed'],
    ]);
  });

  it('shows the end as halted, the failed stage as failed and the rest as not run', () => {
    expect(labels(helloRun(0, { blockedAt: 0 }))).toEqual([
      ['intent', 'done', 'Done'],
      ['stage-draft', 'failed', 'Failed'],
      ['stage-review', 'queued', 'Not run'],
      ['end', 'failed', 'Halted'],
    ]);
  });

  it('keeps the stages that passed before the failed one', () => {
    expect(labels(helloRun(0, { blockedAt: 1 }))).toEqual([
      ['intent', 'done', 'Done'],
      ['stage-draft', 'done', 'Done'],
      ['stage-review', 'failed', 'Failed'],
      ['end', 'failed', 'Halted'],
    ]);
  });

  it('names a stage by the id the graph gives it', () => {
    const run = {
      ...helloRun(0),
      stages: [{ name: 'a-b', status: 'running' as const }],
    };

    expect(nodeStatuses(run).get('stage-a-b')?.state).toBe('running');
  });

  it('gives a status to the stages of the run only, by name, when the workflow was edited during the run', () => {
    // A save is allowed during a run, so the graph may name other stages.
    const statuses = nodeStatuses(helloRun(1));

    expect(statuses.has('stage-draft')).toBe(true);
    expect(statuses.has('stage-renamed-after-the-run-began')).toBe(false);
  });
});
