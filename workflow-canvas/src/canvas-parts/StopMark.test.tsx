// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StopMark } from './StopMark';

describe('StopMark', () => {
  it.each([
    ['passed', 'The run ends after review: passed'],
    ['blocked', 'The run ends after review: blocked'],
    ['not-reached', 'The run ends after review: not reached'],
  ] as const)('is an image named for a %s stage', (state, name) => {
    render(<StopMark stage="review" state={state} />);
    const mark = screen.getByRole('img', { name });

    expect(mark.dataset.state).toBe(state);
  });

  it('names only the mark while the run may still reach the stage', () => {
    render(<StopMark stage="review" state={undefined} />);

    expect(
      screen.getByRole('img', { name: 'The run ends after review' }).dataset
        .state,
    ).toBe('open');
  });

  it('draws a different shape for each state', () => {
    const shapes = (
      ['passed', 'blocked', 'not-reached', undefined] as const
    ).map((state) => {
      const { container, unmount } = render(
        <StopMark stage="review" state={state} />,
      );
      const svg = container.querySelector('svg')!.innerHTML;
      unmount();
      return svg;
    });

    expect(new Set(shapes).size).toBe(4);
  });

  it('is not a live region, and hides its drawing from a screen reader', () => {
    const { container } = render(<StopMark stage="review" state="blocked" />);
    const mark = screen.getByRole('img');

    expect(mark.getAttribute('aria-live')).toBeNull();
    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('shows a stage name with markup in it as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(<StopMark stage={hostile} state="passed" />);

    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('img', {
        name: `The run ends after ${hostile}: passed`,
      }),
    ).toBeTruthy();
  });
});
