// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeLines, type CodeLine } from './CodeLines';

const LINE_PX = 20;
const BOX_PX = 100;

const linesUpTo = (count: number): CodeLine[] =>
  Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    text: `line ${i + 1}`,
  }));

// jsdom lays nothing out, so the box gets the scroll measures of a real one:
// each line is LINE_PX high and the box shows BOX_PX.
function measure(box: HTMLElement) {
  Object.defineProperty(box, 'clientHeight', { value: BOX_PX });
  Object.defineProperty(box, 'scrollHeight', {
    get: () => box.querySelectorAll('li').length * LINE_PX,
  });
}

function renderFollowing(count: number) {
  const view = render(
    <CodeLines lines={linesUpTo(count)} label="Console" followEnd />,
  );
  const box = screen.getByRole('region', { name: 'Console' });
  measure(box);
  const show = (next: number) =>
    view.rerender(
      <CodeLines lines={linesUpTo(next)} label="Console" followEnd />,
    );
  return { box, show };
}

describe('CodeLines that follow the end', () => {
  it('stays on the last line as new lines arrive', () => {
    const { box, show } = renderFollowing(5);
    show(10);
    expect(box.scrollTop).toBe(10 * LINE_PX - BOX_PX);
    show(12);
    expect(box.scrollTop).toBe(12 * LINE_PX - BOX_PX);
  });

  it('does not move after the person scrolls up', () => {
    const { box, show } = renderFollowing(5);
    show(10);
    box.scrollTop = 20;
    fireEvent.scroll(box);
    show(15);
    expect(box.scrollTop).toBe(20);
  });

  it('follows again once the person scrolls back to the bottom', () => {
    const { box, show } = renderFollowing(5);
    show(10);
    box.scrollTop = 20;
    fireEvent.scroll(box);
    box.scrollTop = 10 * LINE_PX - BOX_PX;
    fireEvent.scroll(box);
    show(15);
    expect(box.scrollTop).toBe(15 * LINE_PX - BOX_PX);
  });

  it('leaves the scroll alone without followEnd', () => {
    const view = render(<CodeLines lines={linesUpTo(5)} label="File" />);
    const box = screen.getByRole('region', { name: 'File' });
    measure(box);
    view.rerender(<CodeLines lines={linesUpTo(10)} label="File" />);
    expect(box.scrollTop).toBe(0);
  });
});
