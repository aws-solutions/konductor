// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addParam, draftOf, setParam } from '../designer/core/draft';
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
      screen
        .getByRole('button', { name: 'Remove parameter' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('keeps another row editable when its typed name is goal', () => {
    let draft = addParam(draftOf(STAGES));
    draft = setParam(draft, draft.params.at(-1)!.id, { name: 'goal' });
    render(panel(draft.params));

    const names = screen.getAllByRole('textbox', { name: 'name' });
    expect((names[0] as HTMLInputElement).disabled).toBe(true);
    expect((names[1] as HTMLInputElement).disabled).toBe(false);
    const remove = screen.getAllByRole('button', { name: 'Remove parameter' });
    expect(remove[1]?.getAttribute('aria-disabled')).not.toBe('true');
  });
});
