// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { HELLO_VIEW, helloRun } from '../../test-support/fixtures';
import { stageDrift } from './stage-drift';

describe('stageDrift', () => {
  it('is nothing before there is a run', () => {
    expect(stageDrift(HELLO_VIEW, undefined)).toBeUndefined();
  });

  it('is nothing when the run has the stages of the graph', () => {
    expect(stageDrift(HELLO_VIEW, helloRun(1))).toBeUndefined();
  });

  it('names a stage of the run that the graph does not have', () => {
    const view = { ...HELLO_VIEW, stages: [HELLO_VIEW.stages[0]!] };

    expect(stageDrift(view, helloRun(0))).toEqual({
      notInGraph: ['review'],
      notInRun: [],
    });
  });

  it('names a stage of the graph that the run does not have', () => {
    const view = {
      ...HELLO_VIEW,
      stages: [...HELLO_VIEW.stages, { name: 'ship', agent: 'k-developer' }],
    };

    expect(stageDrift(view, helloRun(0))).toEqual({
      notInGraph: [],
      notInRun: ['ship'],
    });
  });

  it('names a stage that was renamed on both sides', () => {
    const view = {
      ...HELLO_VIEW,
      stages: [{ name: 'write', agent: 'k-developer' }, HELLO_VIEW.stages[1]!],
    };

    expect(stageDrift(view, helloRun(0))).toEqual({
      notInGraph: ['draft'],
      notInRun: ['write'],
    });
  });

  it('is nothing when only the order differs', () => {
    const view = { ...HELLO_VIEW, stages: [...HELLO_VIEW.stages].reverse() };

    expect(stageDrift(view, helloRun(0))).toBeUndefined();
  });
});
