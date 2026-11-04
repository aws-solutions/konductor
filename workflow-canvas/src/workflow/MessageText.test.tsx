// SPDX-License-Identifier: Apache-2.0
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageText } from './MessageText';

describe('MessageText', () => {
  it('shows a name in backticks as code, without the backticks', () => {
    const { container } = render(
      <MessageText text="The stage name `draft` is already used." />,
    );

    expect(container.textContent).toBe('The stage name draft is already used.');
    expect(container.querySelector('code')?.textContent).toBe('draft');
  });

  it('shows every name in the message', () => {
    const { container } = render(
      <MessageText text="`name` must be `hello`, the name of the file." />,
    );

    expect(
      [...container.querySelectorAll('code')].map((code) => code.textContent),
    ).toEqual(['name', 'hello']);
  });

  it('leaves text with a single backtick as it is', () => {
    const { container } = render(<MessageText text="It costs 5` or less." />);

    expect(container.textContent).toBe('It costs 5` or less.');
    expect(container.querySelector('code')).toBeNull();
  });
});
