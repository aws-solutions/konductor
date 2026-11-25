// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildGraph, withStopMarks, type StopMarkState } from '../graph';
import { HELLO_VIEW } from '../test-support/fixtures';
import { WorkflowCanvas } from './WorkflowCanvas';

const LAST = HELLO_VIEW.stages.at(-1)?.name ?? '';

function drawn(states?: ReadonlyMap<string, StopMarkState>) {
  const graph = buildGraph(HELLO_VIEW, 'kiro-cli');
  render(<WorkflowCanvas graph={withStopMarks(graph, states)} />);
}

describe('a canvas drawn with stop marks', () => {
  it('ends the last stage with a stop mark', () => {
    drawn();

    expect(
      screen.getByRole('img', { name: `The run ends after ${LAST}` }),
    ).toBeTruthy();
  });

  it('draws one mark only, on the stage that ends the run', () => {
    drawn();

    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('shows the state of the mark once the stage has passed', () => {
    drawn(new Map([[`stage-${LAST}`, 'passed']]));

    expect(
      screen.getByRole('img', { name: `The run ends after ${LAST}: passed` }),
    ).toBeTruthy();
  });
});
