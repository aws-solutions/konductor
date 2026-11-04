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

  it('lets the key go on to the page in a canvas that can select', () => {
    const { heard, node } = drawn({ selectedId: undefined, onSelect: vi.fn() });

    fireEvent.keyDown(node, { key: 'Escape' });

    expect(heard).toHaveBeenCalledWith('Escape');
  });

  it('lets an open dialog hear the key while a node has focus', () => {
    const closed = vi.fn();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closed();
    };
    document.addEventListener('keydown', onKey);
    const { node } = drawn({ selectedId: 'stage-draft', onSelect: vi.fn() });

    fireEvent.keyDown(node, { key: 'Escape' });
    document.removeEventListener('keydown', onKey);

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('keeps React Flow from handling the key on a node', () => {
    const { node } = drawn({ selectedId: undefined, onSelect: vi.fn() });

    expect(node.classList.contains('nokey')).toBe(true);
  });
});

describe('WorkflowCanvas, on Enter and Space', () => {
  it('chooses the stage and lets the key go on', () => {
    const onSelect = vi.fn();
    const { heard, node } = drawn({ selectedId: undefined, onSelect });

    fireEvent.keyDown(node, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(node.dataset.id);
    expect(heard).toHaveBeenCalledWith('Enter');
  });
});
