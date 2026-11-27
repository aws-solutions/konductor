// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { openDocument, type SaveState } from '../designer/core';
import { HELLO_DOCUMENT } from '../test-support/fixtures';
import { PageHeaderActions } from './PageHeaderActions';
import type { PageView } from './ModeSwitch';

type View = 'designer' | 'execution';

const VIEWS: readonly PageView<View>[] = [
  { id: 'designer', label: 'Design', content: null },
  { id: 'execution', label: 'Run', content: null },
];

function renderHeader(save: SaveState, running = false) {
  const opened = openDocument(HELLO_DOCUMENT);
  if (!opened) throw new Error('The fixture must be editable.');
  render(
    <PageHeaderActions
      views={VIEWS}
      active="designer"
      state={{ ...opened, save }}
      running={running}
      check={{ status: 'valid' }}
      onView={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  return screen.getByTestId('save-status');
}

describe('PageHeaderActions workflow state', () => {
  it.each([
    [{ phase: 'reloading' } as const, 'Loading'],
    [{ phase: 'reloaded' } as const, 'Loaded again from the server'],
  ])('shows the %s phase as %s', (save, text) => {
    expect(renderHeader(save).textContent).toBe(text);
  });

  it('lets a running workflow override the save phase', () => {
    expect(renderHeader({ phase: 'reloading' }, true).textContent).toBe(
      'Running',
    );
  });
});
