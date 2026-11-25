// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HELLO_DOCUMENT, loaded } from '../test-support/fixtures';
import type { LoadResult } from './load-workflow';
import { WorkflowGate } from './WorkflowGate';

function gate(result: LoadResult) {
  return (
    <WorkflowGate result={result}>
      {() => <div role="region" aria-label="Workflow graph" />}
    </WorkflowGate>
  );
}

describe('WorkflowGate', () => {
  it('draws a new canvas when the workflow is replaced, so it is fitted again', () => {
    const { rerender } = render(gate(loaded(HELLO_DOCUMENT)));
    const before = screen.getByRole('region', { name: 'Workflow graph' });

    rerender(gate(loaded(HELLO_DOCUMENT)));

    expect(screen.getByRole('region', { name: 'Workflow graph' })).not.toBe(
      before,
    );
  });

  it('keeps the canvas while the same result is drawn again', () => {
    const result = loaded(HELLO_DOCUMENT);
    const { rerender } = render(gate(result));
    const before = screen.getByRole('region', { name: 'Workflow graph' });

    rerender(gate(result));

    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBe(before);
  });
});
