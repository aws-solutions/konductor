// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { createSwapRisk, guardOffers, swapWarning } from './swap-guard';

describe('swapWarning', () => {
  it('has nothing to say when nothing would be lost', () => {
    expect(swapWarning({ draft: false, run: false })).toBeUndefined();
  });

  it('says the unsaved changes would be dropped', () => {
    expect(swapWarning({ draft: true, run: false })).toBe(
      'Opening this launch address drops your unsaved changes. Cancel keeps this page as it is; paste the address again to open it.',
    );
  });

  it('says the run would no longer be followed, and goes on at its server', () => {
    expect(swapWarning({ draft: false, run: true })).toBe(
      'Opening this launch address stops following the run in progress, which goes on at its server. Cancel keeps this page as it is; paste the address again to open it.',
    );
  });

  it('names both losses', () => {
    expect(swapWarning({ draft: true, run: true })).toContain(
      'drops your unsaved changes and stops following the run in progress',
    );
  });
});

describe('guardOffers', () => {
  const setup = (confirmed: boolean) => {
    const risk = createSwapRisk();
    const confirm = vi.fn(() => confirmed);
    const offer = vi.fn();
    return { risk, confirm, offer, guarded: guardOffers(risk, confirm, offer) };
  };

  it('offers the code without asking when nothing would be lost', () => {
    const { guarded, confirm, offer } = setup(false);

    guarded('code');

    expect(confirm).not.toHaveBeenCalled();
    expect(offer).toHaveBeenCalledWith('code');
  });

  it('offers the code when the person agrees to lose the draft', () => {
    const { risk, guarded, confirm, offer } = setup(true);
    risk.set({ draft: true, run: false });

    guarded('code');

    expect(confirm).toHaveBeenCalledOnce();
    expect(offer).toHaveBeenCalledWith('code');
  });

  it('drops the code when the person keeps the draft', () => {
    const { risk, guarded, offer } = setup(false);
    risk.set({ draft: true, run: false });

    guarded('code');

    expect(offer).not.toHaveBeenCalled();
  });

  it('does not ask while nothing is at risk, and asks when something is', () => {
    const { risk, guarded, confirm } = setup(false);
    risk.set({ draft: true, run: false });
    risk.set({ draft: false, run: false });
    guarded('one');
    risk.set({ draft: false, run: true });
    guarded('two');

    expect(confirm).toHaveBeenCalledOnce();
  });
});
