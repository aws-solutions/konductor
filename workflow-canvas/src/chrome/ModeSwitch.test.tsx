// SPDX-License-Identifier: Apache-2.0
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ModeSwitch, type PageView } from './ModeSwitch';

type ViewId = 'designer' | 'execution';

const views: readonly PageView<ViewId>[] = [
  { id: 'designer', label: 'Designer', content: null },
  { id: 'execution', label: 'Execution', content: null },
];

function Harness({ initial }: { initial: ViewId }) {
  const [active, setActive] = useState<ViewId>(initial);
  return (
    <ModeSwitch
      views={views}
      active={active}
      onChange={setActive}
      ariaLabel="View"
    />
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

function pressKey(element: HTMLElement, init: KeyboardEventInit) {
  const event = createEvent.keyDown(element, init);
  fireEvent(element, event);
  return event;
}

describe('ModeSwitch', () => {
  it('leaves Alt+ArrowLeft to the browser', () => {
    render(<Harness initial="execution" />);

    const event = pressKey(tab('Execution'), {
      key: 'ArrowLeft',
      altKey: true,
    });

    expect(event.defaultPrevented).toBe(false);
    expect(tab('Execution').getAttribute('aria-selected')).toBe('true');
  });

  it('leaves Ctrl+Home to the browser', () => {
    render(<Harness initial="execution" />);

    const event = pressKey(tab('Execution'), { key: 'Home', ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(tab('Execution').getAttribute('aria-selected')).toBe('true');
  });

  it.each([
    { key: 'ArrowRight', metaKey: true },
    { key: 'End', shiftKey: true },
  ])('leaves $key with a modifier to the browser', (init) => {
    render(<Harness initial="designer" />);

    const event = pressKey(tab('Designer'), init);

    expect(event.defaultPrevented).toBe(false);
    expect(tab('Designer').getAttribute('aria-selected')).toBe('true');
  });

  it('still moves the selection with plain arrow keys, Home and End', () => {
    render(<Harness initial="designer" />);

    const right = pressKey(tab('Designer'), { key: 'ArrowRight' });
    expect(right.defaultPrevented).toBe(true);
    expect(tab('Execution').getAttribute('aria-selected')).toBe('true');

    pressKey(tab('Execution'), { key: 'Home' });
    expect(tab('Designer').getAttribute('aria-selected')).toBe('true');

    pressKey(tab('Designer'), { key: 'End' });
    expect(tab('Execution').getAttribute('aria-selected')).toBe('true');
  });
});
