// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeNextPorts } from '../test-support/next-ports';
import { LibraryView } from './LibraryView';

const READY = {
  name: 'library/k-adversarial-pull-request-review',
  title: 'Adversarial pull request review',
  summary: 'Review a pull request.',
  status: 'ready' as const,
};
const PLANNED = {
  name: 'library/k-design-doc-creation',
  title: 'Design document creation',
  summary: 'Create a design document.',
  status: 'planned' as const,
  waits: 'The workflow needs human gates.',
};

function subject(over = {}) {
  const ports = fakeNextPorts({
    listLibrary: vi.fn(() => Promise.resolve([READY, PLANNED])),
    ...over,
  });
  const rendered = render(<LibraryView ports={ports} />);
  return { ports, ...rendered };
}

describe('LibraryView', () => {
  it('lists ready and planned workflows with their status', async () => {
    subject();

    expect(await screen.findByText(READY.title)).toBeTruthy();
    expect(screen.getByText(PLANNED.title)).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getAllByText(PLANNED.waits).length).toBeGreaterThan(0);
  });

  it('keeps every action focusable while explaining why it is off', async () => {
    subject();
    await screen.findByText(READY.title);

    for (const name of [
      `Open ${READY.title}`,
      `Start from ${READY.title}`,
      `Open ${PLANNED.title}`,
      `Start from ${PLANNED.title}`,
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('clears a successful result when ports change', async () => {
    const { rerender } = subject();
    await screen.findByText(READY.title);
    const next = fakeNextPorts({
      listLibrary: vi.fn(() => Promise.resolve([PLANNED])),
    });

    rerender(<LibraryView ports={next} />);

    expect(screen.queryByText(READY.title)).toBeNull();
    expect(screen.getByText('Loading Library')).toBeTruthy();
    expect(await screen.findByText(PLANNED.title)).toBeTruthy();
  });

  it('clears a failure when ports change', async () => {
    const { rerender } = subject({
      listLibrary: vi.fn(() => Promise.reject(new Error('Library failed.'))),
    });
    await screen.findByText('Library failed.');
    const next = fakeNextPorts({
      listLibrary: vi.fn(() => Promise.resolve([READY])),
    });

    rerender(<LibraryView ports={next} />);

    expect(screen.queryByText('Library failed.')).toBeNull();
    expect(screen.getByText('Loading Library')).toBeTruthy();
    expect(await screen.findByText(READY.title)).toBeTruthy();
  });

  it('shows a failed list request', async () => {
    subject({
      listLibrary: vi.fn(() => Promise.reject(new Error('Library failed.'))),
    });

    expect(await screen.findByText('Library failed.')).toBeTruthy();
  });
});
