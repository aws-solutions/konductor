// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildGraph } from '../graph';
import { HELLO_VIEW } from '../test-support/fixtures';
import { WorkflowCanvas, type CanvasSelection } from './WorkflowCanvas';

const GRAPH = buildGraph(HELLO_VIEW, 'kiro-cli');

// Draws the canvas under a parent that hears the keys which reach it.
function drawn(selection?: CanvasSelection) {
  const heard = vi.fn();
  render(
    <div onKeyDown={(event) => heard(event.key)}>
      <WorkflowCanvas graph={GRAPH} selection={selection} />
    </div>,
  );
  return { heard, node: screen.getByTestId('node-stage-draft').parentElement! };
}

describe('WorkflowCanvas, on the Escape key', () => {
  it('lets the key go on in a canvas that cannot select', () => {
    const { heard, node } = drawn();

    fireEvent.keyDown(node, { key: 'Escape' });

    expect(heard).toHaveBeenCalledWith('Escape');
  });

  it('keeps the key from React Flow in a canvas that can select', () => {
    const { heard, node } = drawn({ selectedId: undefined, onSelect: vi.fn() });

    fireEvent.keyDown(node, { key: 'Escape' });

    expect(heard).not.toHaveBeenCalled();
  });
});
