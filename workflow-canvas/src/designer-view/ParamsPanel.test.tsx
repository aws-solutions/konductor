// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addParam, draftOf, setParam } from '../designer/core/draft';
import { PARAM_NAME_ERROR } from '../designer/core/param-text';
import { ParamsPanel } from './ParamsPanel';

const STAGES = [{ name: 'draft', agent: 'k-developer' }];

function panel(params: ReturnType<typeof draftOf>['params']) {
  return (
    <ParamsPanel
      params={params}
      disabled={false}
      onChange={() => {}}
      onAdd={() => {}}
      onRemove={() => {}}
    />
  );
}

describe('ParamsPanel goal identity', () => {
  it('always shows one protected goal row', () => {
    const draft = draftOf(STAGES);
    render(panel(draft.params));

    expect(draft.params[0]?.isGoal).toBe(true);
    expect(
      (screen.getByRole('textbox', { name: 'name' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: 'required' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    const remove = screen.getByRole('button', { name: 'Remove parameter' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps another row editable when its typed name is goal', () => {
    let draft = addParam(draftOf(STAGES));
    draft = setParam(draft, draft.params.at(-1)!.id, { name: 'goal' });
    render(panel(draft.params));

    const names = screen.getAllByRole('textbox', { name: 'name' });
    expect((names[0] as HTMLInputElement).disabled).toBe(true);
    expect((names[1] as HTMLInputElement).disabled).toBe(false);
    const required = screen.getAllByRole('checkbox', { name: 'required' });
    expect((required[0] as HTMLInputElement).disabled).toBe(true);
    expect((required[1] as HTMLInputElement).disabled).toBe(false);
    const remove = screen.getAllByRole('button', { name: 'Remove parameter' });
    expect(remove[0]?.getAttribute('aria-disabled')).toBe('true');
    expect((remove[1] as HTMLButtonElement).disabled).toBe(false);
    expect(remove[1]?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('associates a writer name error without freezing the row', () => {
    let draft = addParam(draftOf(STAGES));
    draft = setParam(draft, draft.params.at(-1)!.id, {
      name: 'topic: {description: injected} #',
    });
    render(panel(draft.params));

    const input = screen.getAllByRole('textbox', { name: 'name' })[1]!;
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(described).toContain(PARAM_NAME_ERROR);
  });
});
